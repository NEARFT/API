"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseRpcError = void 0;
const providers_1 = require("../providers");
function parseRpcError(errorObj) {
    // const result = {};
    return new providers_1.TypedError();
}
exports.parseRpcError = parseRpcError;
// /**
//  * Helper function determining if the argument is an object
//  * @param n Value to check
//  */
// function isObject(n) {
//     return Object.prototype.toString.call(n) === '[object Object]';
// }
// /**
//  * Helper function determining if the argument is a string
//  * @param n Value to check
//  */
// function isString(n) {
//     return Object.prototype.toString.call(n) === '[object String]';
// }
