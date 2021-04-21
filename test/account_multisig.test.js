/* global BigInt */
const nearApi = require("../lib/index");
const fs = require("fs");
const BN = require("bn.js");
const testUtils = require("./test-utils");
const semver = require("semver");

let nearjs;
let startFromVersion;

const {
    KeyPair,
    transactions: { functionCall },
    InMemorySigner,
    multisig: { Account2FA, MULTISIG_GAS, MULTISIG_DEPOSIT },
    utils: {
        format: { parseNearAmount },
    },
} = nearApi;

jasmine.DEFAULT_TIMEOUT_INTERVAL = 50000;

const getAccount2FA = async (
    account,
    keyMapping = ({ public_key: publicKey }) => ({ publicKey, kind: "phone" })
) => {
    // modifiers to functions replaces contract helper (CH)
    const { accountId } = account;
    const keys = await account.getAccessKeys();
    const account2fa = new Account2FA(nearjs.connection, accountId, {
        // skip this (not using CH)
        getCode: () => {},
        sendCode: () => {},
        // auto accept "code"
        verifyCode: () => ({}), // TODO: Is there any content needed in result?
        onAddRequestResult: async () => {
            const { requestId } = account2fa.getRequest();
            // set confirmKey as signer
            const originalSigner = nearjs.connection.signer;
            nearjs.connection.signer = await InMemorySigner.fromKeyPair(
                nearjs.connection.networkId,
                accountId,
                account2fa.confirmKey
            );
            // 2nd confirmation signing with confirmKey from Account instance
            await account.signAndSendTransaction(accountId, [
                functionCall(
                    "confirm",
                    { request_id: requestId },
                    MULTISIG_GAS,
                    MULTISIG_DEPOSIT
                ),
            ]);
            nearjs.connection.signer = originalSigner;
        },
    });
    account2fa.confirmKey = KeyPair.fromRandom("ed25519");
    account2fa.postSignedJson = () => ({
        publicKey: account2fa.confirmKey.getPublicKey(),
    });
    account2fa.getRecoveryMethods = () => ({
        data: keys.map(keyMapping),
    });
    await account2fa.deployMultisig([
        ...fs.readFileSync("./test/data/multisig.wasm"),
    ]);
    return account2fa;
};

beforeAll(async () => {
    nearjs = await testUtils.setUpTestConnection();
    let nodeStatus = await nearjs.connection.provider.status();
    startFromVersion = (version) =>
        semver.gte(nodeStatus.version.version, version);
    console.log(startFromVersion);
});

describe.skip("deployMultisig key rotations", () => {
    test('full access key if recovery method is "ledger" or "phrase", limited access key if "phone"', async () => {
        const account = await testUtils.createAccount(nearjs);
        await account.addKey(KeyPair.fromRandom("ed25519").getPublicKey());
        await account.addKey(KeyPair.fromRandom("ed25519").getPublicKey());
        const keys = await account.getAccessKeys();
        const kinds = ["ledger", "phrase", "phone"];
        const account2fa = await getAccount2FA(
            account,
            ({ public_key: publicKey }, i) => ({ publicKey, kind: kinds[i] })
        );
        const currentKeys = await account2fa.getAccessKeys();
        expect(
            currentKeys.find(
                ({ public_key }) => keys[0].public_key === public_key
            ).access_key.permission
        ).toEqual("FullAccess");
        expect(
            currentKeys.find(
                ({ public_key }) => keys[1].public_key === public_key
            ).access_key.permission
        ).toEqual("FullAccess");
        expect(
            currentKeys.find(
                ({ public_key }) => keys[2].public_key === public_key
            ).access_key.permission
        ).not.toEqual("FullAccess");
    });
});

describe.skip("account2fa transactions", () => {
    test("add app key before deployMultisig", async () => {
        let account = await testUtils.createAccount(nearjs);
        const appPublicKey = KeyPair.fromRandom("ed25519").getPublicKey();
        const appAccountId = "foobar";
        const appMethodNames = ["some_app_stuff", "some_more_app_stuff"];
        await account.addKey(
            appPublicKey.toString(),
            appAccountId,
            appMethodNames,
            new BN(parseNearAmount("0.25"))
        );
        account = await getAccount2FA(account);
        const keys = await account.getAccessKeys();
        expect(
            keys.find(
                ({ public_key }) => appPublicKey.toString() === public_key
            ).access_key.permission.FunctionCall.method_names
        ).toEqual(appMethodNames);
        expect(
            keys.find(
                ({ public_key }) => appPublicKey.toString() === public_key
            ).access_key.permission.FunctionCall.receiver_id
        ).toEqual(appAccountId);
    });

    test("add app key", async () => {
        let account = await testUtils.createAccount(nearjs);
        account = await getAccount2FA(account);
        const appPublicKey = KeyPair.fromRandom("ed25519").getPublicKey();
        const appAccountId = "foobar";
        const appMethodNames = ["some_app_stuff", "some_more_app_stuff"];
        await account.addKey(
            appPublicKey.toString(),
            appAccountId,
            appMethodNames,
            new BN(parseNearAmount("0.25"))
        );
        const keys = await account.getAccessKeys();
        expect(
            keys.find(
                ({ public_key }) => appPublicKey.toString() === public_key
            ).access_key.permission.FunctionCall.method_names
        ).toEqual(appMethodNames);
        expect(
            keys.find(
                ({ public_key }) => appPublicKey.toString() === public_key
            ).access_key.permission.FunctionCall.receiver_id
        ).toEqual(appAccountId);
    });

    test("send money", async () => {
        let sender = await testUtils.createAccount(nearjs);
        let receiver = await testUtils.createAccount(nearjs);
        sender = await getAccount2FA(sender);
        receiver = await getAccount2FA(receiver);
        const { amount: receiverAmount } = await receiver.state();
        await sender.sendMoney(
            receiver.accountId,
            new BN(parseNearAmount("1"))
        );
        const state = await receiver.state();
        expect(BigInt(state.amount)).toBeGreaterThanOrEqual(
            BigInt(
                new BN(receiverAmount)
                    .add(new BN(parseNearAmount("0.9")))
                    .toString()
            )
        );
    });
});

describe("multisig transactions", () => {
    test("delete unconfirmed request", async () => {
        const account = await testUtils.createAccount(nearjs);
        const accountWith2FA = await getAccount2FA(account);
        const actions = [nearApi.transactions.transfer("1000000000")];

        const GAS = new BN("1000000000000000000000");

        const convertActions = (actions, accountId, receiverId) =>
            actions.map((a) => {
                const type = a.enum;
                const {
                    gas,
                    publicKey,
                    methodName,
                    args,
                    deposit,
                    accessKey,
                    code,
                } = a[type];
                const action = {
                    type: type[0].toUpperCase() + type.substr(1),
                    gas: (gas && gas.toString()) || undefined,
                    public_key:
                        (publicKey && convertPKForContract(publicKey)) ||
                        undefined,
                    method_name: methodName,
                    args:
                        (args && Buffer.from(args).toString("base64")) ||
                        undefined,
                    code:
                        (code && Buffer.from(code).toString("base64")) ||
                        undefined,
                    amount: (deposit && deposit.toString()) || undefined,
                    deposit: (deposit && deposit.toString()) || "0",
                    permission: undefined,
                };
                if (accessKey) {
                    if (
                        receiverId === accountId &&
                        accessKey.permission.enum !== "fullAccess"
                    ) {
                        action.permission = {
                            receiver_id: accountId,
                            allowance: MULTISIG_ALLOWANCE.toString(),
                            method_names: MULTISIG_CHANGE_METHODS,
                        };
                    }
                    if (accessKey.permission.enum === "functionCall") {
                        const {
                            receiverId: receiver_id,
                            methodNames: method_names,
                            allowance,
                        } = accessKey.permission.functionCall;
                        action.permission = {
                            receiver_id,
                            allowance:
                                (allowance && allowance.toString()) ||
                                undefined,
                            method_names,
                        };
                    }
                }
                return action;
            });

        accountWith2FA.setRequest({
            accountId: "test-account",
            requestId: 2,
            actions: [actions],
        });

        console.log(
            JSON.stringify({
                request: {
                    receiver_id: "test-account",

                    actions: [actions],
                },
            })
        );
        // {"request": {"receiver_id": "illia", "actions": [{"type": "Transfer", "amount": "1000000000000000000000"}]}}
        // console.log(
        //     await accountWith2FA.contract.add_request({
        //         request: {
        //             accountId: "test-account",
        //             requestId: 2,
        //             actions: [actions],
        //         },
        //     })
        // );

        console.log(Object.keys(accountWith2FA.contract));

        await accountWith2FA.contract.add_request(
            Buffer.from(
                JSON.stringify({
                    request: {
                        receiver_id: "test-account",
                        actions: convertActions(
                            actions,
                            accountWith2FA.accountId,
                            "test-account"
                        ),
                    },
                })
            )
        );

        // await accountWith2FA.signAndSendTransaction(account.accountId, [
        //     functionCall(
        //         "add_request",
        //         Buffer.from(
        //             JSON.stringify({
        //                 request: {
        //                     receiver_id: "test-account",
        //                     actions: [actions],
        //                 },
        //             })
        //         ),
        //         GAS,
        //         MULTISIG_DEPOSIT
        //     ),
        // ]);

        // await accountWith2FA.signAndSendTransactionAddUnconfirmedRequest(
        //     actions,
        //     GAS,
        //     MULTISIG_DEPOSIT
        // );

        console.log("should be something ", await accountWith2FA.getRequest());
        await accountWith2FA.deleteUnconfirmedRequests();
        console.log("should be empty", await accountWith2FA.getRequest());
        // console.log('requests: ', await accountWith2FA.getRequest());

        // expect(result).toThrow(new Error('[DEL_ERR] Attempt to delete an earlier request before 15 minutes failed. Will try again.'));
    });
});
