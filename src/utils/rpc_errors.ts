import { TypedError } from "../providers";


export function parseRpcError(errorObj: Record<string, any>): TypedError {
    // const result = {};


    return new TypedError();
}

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
