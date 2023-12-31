/*!
 * https://github.com/Starcounter-Jack/JSON-Patch
 * (c) 2013-2021 Joachim Wester
 * MIT license
 */

function hasOwnProperty(obj, key) {
	return Object.prototype.hasOwnProperty.call(obj, key);
}

function objectKeys(obj) {
	if (Array.isArray(obj)) {
		const keys = new Array(obj.length);
		for (let k = 0; k < keys.length; k++) {
			keys[k] = `${k}`;
		}

		return keys;
	}
	if (Object.keys) {
		return Object.keys(obj);
	}
	const keys = [];
	for (const i in obj) {
		if (hasOwnProperty(obj, i)) {
			keys.push(i);
		}
	}

	return keys;
}

/**
* Deeply clone the object.
* https://jsperf.com/deep-copy-vs-json-stringify-json-parse/25 (recursiveDeepCopy)
* @param  {any} obj value to clone
* @return {any} cloned obj
*/
export function deepClone(obj) {
	switch (typeof obj) {
	case 'object':
		return JSON.parse(JSON.stringify(obj)); // Faster than ES5 clone - http://jsperf.com/deep-cloning-of-objects/5
	case 'undefined':
		return null; // this is how JSON.stringify behaves for array items
	default:
		return obj; // no need to clone primitives
	}
}

// 3x faster than cached /^\d+$/.test(str)
function isInteger(str) {
	let i = 0;
	const len = str.length;
	let charCode;
	while (i < len) {
		charCode = str.charCodeAt(i);
		if (charCode >= 48 && charCode <= 57) {
			i++;
			continue;
		}

		return false;
	}

	return true;
}
/**
* Escapes a json pointer path
* @param path The raw pointer
* @return the Escaped path
*/
function escapePathComponent(path) {
	if (path.indexOf('/') === -1 && path.indexOf('~') === -1) return path;

	return path.replace(/~/g, '~0').replace(/\//g, '~1');
}
/**
 * Unescapes a json pointer path
 * @param path The escaped pointer
 * @return The unescaped path
 */
function unescapePathComponent(path) {
	return path.replace(/~1/g, '/').replace(/~0/g, '~');
}

function getPathRecursive(root, obj) {
	let found;
	for (const key in root) {
		if (hasOwnProperty(root, key)) {
			if (root[key] === obj) {
				return `${escapePathComponent(key)}/`;
			}
			if (typeof root[key] === 'object') {
				found = getPathRecursive(root[key], obj);
				if (found !== '') {
					return `${escapePathComponent(key)}/${found}`;
				}
			}
		}
	}

	return '';
}

export function getPath(root, obj) {
	if (root === obj) {
		return '/';
	}
	const path = getPathRecursive(root, obj);
	if (path === '') {
		throw new Error('Object not found in root');
	}

	return `/${path}`;
}

function hasUndefined(obj) {
	if (obj === undefined) {
		return true;
	}
	if (obj) {
		if (Array.isArray(obj)) {
			for (let i = 0, len = obj.length; i < len; i++) {
				if (hasUndefined(obj[i])) {
					return true;
				}
			}
		} else if (typeof obj === 'object') {
			const objKeys = objectKeys(obj);
			const objKeysLength = objKeys.length;
			for (let i = 0; i < objKeysLength; i++) {
				if (hasUndefined(obj[objKeys[i]])) {
					return true;
				}
			}
		}
	}

	return false;
}

function patchErrorMessageFormatter(message, args) {
	const messageParts = [message];
	for (const key in args) {
		const value = typeof args[key] === 'object' ? JSON.stringify(args[key], null, 2) : args[key]; // pretty print
		if (typeof value !== 'undefined') {
			messageParts.push(`${key}: ${value}`);
		}
	}

	return messageParts.join('\n');
}

export class JsonPatchError extends Error {
	constructor(message, name, index, operation, tree) {
		super(patchErrorMessageFormatter(message, {
			name, index, operation, tree
		}));
		Object.setPrototypeOf(this, new.target.prototype); // restore prototype chain, see https://stackoverflow.com/a/48342359
		this.message = patchErrorMessageFormatter(message, {
			name, index, operation, tree
		});
	}
}

// Dirty check if obj is different from mirror, generate patches and update mirror
function generate(mirror, obj, patches, path, invertible) {
	if (obj === mirror) {
		return;
	}

	if (typeof obj.toJSON === 'function') {
		obj = obj.toJSON();
	}

	const newKeys = objectKeys(obj);
	const oldKeys = objectKeys(mirror);
	let deleted = false;

	for (let t = oldKeys.length - 1; t >= 0; t--) {
		const key = oldKeys[t];
		const oldVal = mirror[key];

		if (hasOwnProperty(obj, key)
      && !(obj[key] === undefined
      && oldVal !== undefined
      && Array.isArray(obj) === false)) {
			const newVal = obj[key];

			if (typeof oldVal === 'object' && oldVal != null && typeof newVal === 'object' && newVal != null && Array.isArray(oldVal) === Array.isArray(newVal)) {
				generate(oldVal, newVal, patches, `${path}/${escapePathComponent(key)}`, invertible);
			} else if (oldVal !== newVal) {
				if (invertible) {
					patches.push({ op: 'test', path: `${path}/${escapePathComponent(key)}`, value: deepClone(oldVal) });
				}
				patches.push({ op: 'replace', path: `${path}/${escapePathComponent(key)}`, value: deepClone(newVal) });
			}
		} else if (Array.isArray(mirror) === Array.isArray(obj)) {
			if (invertible) {
				patches.push({ op: 'test', path: `${path}/${escapePathComponent(key)}`, value: deepClone(oldVal) });
			}
			patches.push({ op: 'remove', path: `${path}/${escapePathComponent(key)}` });
			deleted = true; // property has been deleted
		} else {
			if (invertible) {
				patches.push({ op: 'test', path, value: mirror });
			}
			patches.push({ op: 'replace', path, value: obj });
		}
	}

	if (!deleted && newKeys.length === oldKeys.length) {
		return;
	}

	for (let t = 0; t < newKeys.length; t++) {
		const key = newKeys[t];
		if (!hasOwnProperty(mirror, key) && obj[key] !== undefined) {
			patches.push({ op: 'add', path: `${path}/${escapePathComponent(key)}`, value: deepClone(obj[key]) });
		}
	}
}

/**
 * Create an array of patches from the differences in two objects
 */
export function compare(tree1, tree2, invertible = false) {
	const patches = [];
	generate(tree1, tree2, patches, '', invertible);

	return patches;
}

/* We use a Javascript hash to store each
 function. Each hash entry (property) uses
 the operation identifiers specified in rfc6902.
 In this way, we can map each patch operation
 to its dedicated function in efficient way.
 */

/* The operations applicable to an object */
const objOps = {
	add(obj, key, document) {
		obj[key] = this.value;

		return { newDocument: document };
	},
	remove(obj, key, document) {
		const removed = obj[key];
		delete obj[key];

		return { newDocument: document, removed };
	},
	replace(obj, key, document) {
		const removed = obj[key];
		obj[key] = this.value;

		return { newDocument: document, removed };
	},
	move(obj, key, document) {
		/* in case move target overwrites an existing value,
    return the removed value, this can be taxing performance-wise,
    and is potentially unneeded */
		let removed = getValueByPointer(document, this.path);

		if (removed) {
			removed = deepClone(removed);
		}

		const originalValue = applyOperation(
			document,
			{ op: 'remove', path: this.from }
		).removed;

		applyOperation(
			document,
			{ op: 'add', path: this.path, value: originalValue }
		);

		return { newDocument: document, removed };
	},
	copy(obj, key, document) {
		const valueToCopy = getValueByPointer(document, this.from);
		// enforce copy by value so further operations don't affect source (see issue #177)
		applyOperation(
			document,
			{ op: 'add', path: this.path, value: deepClone(valueToCopy) }
		);

		return { newDocument: document };
	},
	test(obj, key, document) {
		return { newDocument: document, test: areEquals(obj[key], this.value) };
	},
	// eslint-disable-next-line no-underscore-dangle
	_get(obj, key, document) {
		this.value = obj[key];

		return { newDocument: document };
	}
};

/* The operations applicable to an array. Many are the same as for the object */
const arrOps = {
	add(arr, i, document) {
		if (isInteger(i)) {
			arr.splice(i, 0, this.value);
		} else { // array props
			arr[i] = this.value;
		}

		// this may be needed when using '-' in an array
		return { newDocument: document, index: i };
	},
	remove(arr, i, document) {
		const removedList = arr.splice(i, 1);

		return { newDocument: document, removed: removedList[0] };
	},
	replace(arr, i, document) {
		const removed = arr[i];
		arr[i] = this.value;

		return { newDocument: document, removed };
	},
	move: objOps.move,
	copy: objOps.copy,
	test: objOps.test,
	// eslint-disable-next-line no-underscore-dangle
	_get: objOps._get
};

/**
 * Retrieves a value from a JSON document by a JSON pointer.
 * Returns the value.
 *
 * @param document The document to get the value from
 * @param pointer an escaped JSON pointer
 * @return The retrieved value
 */
export function getValueByPointer(document, pointer) {
	if (pointer === '') {
		return document;
	}
	const getOriginalDestination = { op: '_get', path: pointer };
	applyOperation(document, getOriginalDestination);

	return getOriginalDestination.value;
}

/**
 * Apply a single JSON Patch Operation on a JSON document.
 * Returns the {newDocument, result} of the operation.
 * It modifies the `document` and `operation` objects - it gets the values by reference.
 * If you would like to avoid touching your values, clone them:
 * `jsonpatch.applyOperation(document, jsonpatch._deepClone(operation))`.
 *
 * @param document The document to patch
 * @param operation The operation to apply
 * @param validateOperation `false` is without validation, `true` to use default jsonpatch's validation, or you can pass a `validateOperation` callback to be used for validation.
 * @param mutateDocument Whether to mutate the original document or clone it before applying
 * @param banPrototypeModifications Whether to ban modifications to `__proto__`, defaults to `true`.
 * @return `{newDocument, result}` after the operation
 */
export function applyOperation(
	document,
	operation,
	validateOperation = false,
	mutateDocument = true,
	banPrototypeModifications = true,
	index = 0
) {
	if (validateOperation) {
		if (typeof validateOperation === 'function') {
			validateOperation(operation, 0, document, operation.path);
		} else {
			validator(operation, 0);
		}
	}
	/* ROOT OPERATIONS */
	if (operation.path === '') {
		const returnValue = { newDocument: document };
		if (operation.op === 'add') {
			returnValue.newDocument = operation.value;

			return returnValue;
		} if (operation.op === 'replace') {
			returnValue.newDocument = operation.value;
			returnValue.removed = document;

			return returnValue;
		}
		if (operation.op === 'move' || operation.op === 'copy') {
			returnValue.newDocument = getValueByPointer(document, operation.from);
			if (operation.op === 'move') {
				returnValue.removed = document;
			}

			return returnValue;
		} if (operation.op === 'test') {
			returnValue.test = areEquals(document, operation.value);
			if (returnValue.test === false) {
				throw new JsonPatchError('Test operation failed', 'TEST_OPERATION_FAILED', index, operation, document);
			}
			returnValue.newDocument = document;

			return returnValue;
		} if (operation.op === 'remove') {
			returnValue.removed = document;
			returnValue.newDocument = null;

			return returnValue;
		} if (operation.op === '_get') {
			operation.value = document;

			return returnValue;
		} /* bad operation */
		if (validateOperation) {
			throw new JsonPatchError('Operation `op` property is not one of operations defined in RFC-6902', 'OPERATION_OP_INVALID', index, operation, document);
		} else {
			return returnValue;
		}
	} else {
		if (!mutateDocument) {
			document = deepClone(document);
		}

		const path = operation.path || '';
		const keys = path.split('/');
		let obj = document;
		let t = 1; // skip empty element - http://jsperf.com/to-shift-or-not-to-shift
		const len = keys.length;
		let existingPathFragment;
		let key;
		let validateFunction;
		if (typeof validateOperation === 'function') {
			validateFunction = validateOperation;
		} else {
			validateFunction = validator;
		}

		for (;;) {
			key = keys[t];
			if (key && key.includes('~')) {
				key = unescapePathComponent(key);
			}

			if (banPrototypeModifications
          && (key === '__proto__'
          || (key === 'prototype' && t > 0 && keys[t - 1] === 'constructor'))
			) {
				throw new TypeError('JSON-Patch: modifying `__proto__` or `constructor/prototype` prop is banned for security reasons, if this was on purpose, please set `banPrototypeModifications` flag false and pass it to this function. More info in fast-json-patch README');
			}

			if (validateOperation) {
				if (existingPathFragment === undefined) {
					if (obj[key] === undefined) {
						existingPathFragment = keys.slice(0, t).join('/');
					} else if (t === len - 1) {
						existingPathFragment = operation.path;
					}
					if (existingPathFragment !== undefined) {
						validateFunction(operation, 0, document, existingPathFragment);
					}
				}
			}
			t++;
			if (Array.isArray(obj)) {
				if (key === '-') {
					key = obj.length;
				} else if (validateOperation && !isInteger(key)) {
					throw new JsonPatchError('Expected an unsigned base-10 integer value, making the new referenced value the array element with the zero-based index', 'OPERATION_PATH_ILLEGAL_ARRAY_INDEX', index, operation, document);
				} else if (isInteger(key)) {
					// eslint-disable-next-line no-bitwise
					key = ~~key;
				}
				if (t >= len) {
					if (validateOperation && operation.op === 'add' && key > obj.length) {
						throw new JsonPatchError('The specified index MUST NOT be greater than the number of elements in the array', 'OPERATION_VALUE_OUT_OF_BOUNDS', index, operation, document);
					}
					const returnValue = arrOps[operation.op].call(operation, obj, key, document);
					if (returnValue.test === false) {
						throw new JsonPatchError('Test operation failed', 'TEST_OPERATION_FAILED', index, operation, document);
					}

					return returnValue;
				}
			} else if (t >= len) {
				const returnValue = objOps[operation.op].call(operation, obj, key, document); // Apply patch
				if (returnValue.test === false) {
					throw new JsonPatchError('Test operation failed', 'TEST_OPERATION_FAILED', index, operation, document);
				}

				return returnValue;
			}
			obj = obj[key];
			// If we have more keys in the path, but the next value isn't a non-null object,
			// throw an OPERATION_PATH_UNRESOLVABLE error instead of iterating again.
			if (validateOperation && t < len && (!obj || typeof obj !== 'object')) {
				throw new JsonPatchError('Cannot perform operation at the desired path', 'OPERATION_PATH_UNRESOLVABLE', index, operation, document);
			}
		}
	}
}

/**
 * Apply a full JSON Patch array on a JSON document.
 * Returns the {newDocument, result} of the patch.
 * It modifies the `document` object and `patch` - it gets the values by reference.
 * If you would like to avoid touching your values, clone them:
 * `jsonpatch.applyPatch(document, jsonpatch._deepClone(patch))`.
 *
 * @param document The document to patch
 * @param patch The patch to apply
 * @param validateOperation `false` is without validation, `true` to use default jsonpatch's validation, or you can pass a `validateOperation` callback to be used for validation.
 * @param mutateDocument Whether to mutate the original document or clone it before applying
 * @param banPrototypeModifications Whether to ban modifications to `__proto__`, defaults to `true`.
 * @return An array of `{newDocument, result}` after the patch
 */
export function applyPatch(
	document,
	patch,
	validateOperation,
	mutateDocument = true,
	banPrototypeModifications = true
) {
	if (validateOperation) {
		if (!Array.isArray(patch)) {
			throw new JsonPatchError('Patch sequence must be an array', 'SEQUENCE_NOT_AN_ARRAY');
		}
	}
	if (!mutateDocument) {
		document = deepClone(document);
	}
	const results = new Array(patch.length);

	for (let i = 0, { length } = patch; i < length; i++) {
		// we don't need to pass mutateDocument argument because if it was true, we already deep cloned
		// the object, we'll just pass `true`
		results[i] = applyOperation(
			document,
			patch[i],
			validateOperation,
			true,
			banPrototypeModifications,
			i
		);
		document = results[i].newDocument; // in case root was replaced
	}
	results.newDocument = document;

	return results;
}

/**
 * Apply a single JSON Patch Operation on a JSON document.
 * Returns the updated document.
 * Suitable as a reducer.
 *
 * @param document The document to patch
 * @param operation The operation to apply
 * @return The updated document
 */
export function applyReducer(document, operation, index) {
	const operationResult = applyOperation(document, operation);
	if (operationResult.test === false) { // failed test
		throw new JsonPatchError('Test operation failed', 'TEST_OPERATION_FAILED', index, operation, document);
	}

	return operationResult.newDocument;
}

/**
 * Validates a single operation. Called from `jsonpatch.validate`. Throws `JsonPatchError` in case
 * of an error.
 * @param {object} operation - operation object (patch)
 * @param {number} index - index of operation in the sequence
 * @param {object} [document] - object where the operation is supposed to be applied
 * @param {string} [existingPathFragment] - comes along with `document`
 */
export function validator(operation, index, document, existingPathFragment) {
	if (typeof operation !== 'object' || operation === null || Array.isArray(operation)) {
		throw new JsonPatchError('Operation is not an object', 'OPERATION_NOT_AN_OBJECT', index, operation, document);
	} else if (!objOps[operation.op]) {
		throw new JsonPatchError('Operation `op` property is not one of operations defined in RFC-6902', 'OPERATION_OP_INVALID', index, operation, document);
	} else if (typeof operation.path !== 'string') {
		throw new JsonPatchError('Operation `path` property is not a string', 'OPERATION_PATH_INVALID', index, operation, document);
	} else if (operation.path.indexOf('/') !== 0 && operation.path.length > 0) {
		// paths that aren't empty string should start with "/"
		throw new JsonPatchError('Operation `path` property must start with "/"', 'OPERATION_PATH_INVALID', index, operation, document);
	} else if ((operation.op === 'move' || operation.op === 'copy') && typeof operation.from !== 'string') {
		throw new JsonPatchError('Operation `from` property is not present (applicable in `move` and `copy` operations)', 'OPERATION_FROM_REQUIRED', index, operation, document);
	} else if ((operation.op === 'add' || operation.op === 'replace' || operation.op === 'test') && operation.value === undefined) {
		throw new JsonPatchError('Operation `value` property is not present (applicable in `add`, `replace` and `test` operations)', 'OPERATION_VALUE_REQUIRED', index, operation, document);
	} else if ((operation.op === 'add' || operation.op === 'replace' || operation.op === 'test') && hasUndefined(operation.value)) {
		throw new JsonPatchError('Operation `value` property is not present (applicable in `add`, `replace` and `test` operations)', 'OPERATION_VALUE_CANNOT_CONTAIN_UNDEFINED', index, operation, document);
	} else if (document) {
		if (operation.op === 'add') {
			const pathLen = operation.path.split('/').length;
			const existingPathLen = existingPathFragment.split('/').length;
			if (pathLen !== existingPathLen + 1 && pathLen !== existingPathLen) {
				throw new JsonPatchError('Cannot perform an `add` operation at the desired path', 'OPERATION_PATH_CANNOT_ADD', index, operation, document);
			}
		} else if (operation.op === 'replace' || operation.op === 'remove' || operation.op === '_get') {
			if (operation.path !== existingPathFragment) {
				throw new JsonPatchError('Cannot perform the operation at a path that does not exist', 'OPERATION_PATH_UNRESOLVABLE', index, operation, document);
			}
		} else if (operation.op === 'move' || operation.op === 'copy') {
			const existingValue = { op: '_get', path: operation.from, value: undefined };
			const error = validate([existingValue], document);
			if (error && error.name === 'OPERATION_PATH_UNRESOLVABLE') {
				throw new JsonPatchError('Cannot perform the operation from a path that does not exist', 'OPERATION_FROM_UNRESOLVABLE', index, operation, document);
			}
		}
	}
}

/**
 * Validates a sequence of operations. If `document` parameter is provided, the sequence is
 * additionally validated against the object document.
 * If error is encountered, returns a JsonPatchError object
 * @param sequence
 * @param document
 * @returns {JsonPatchError|undefined}
 */
export function validate(sequence, document, externalValidator) {
	try {
		if (!Array.isArray(sequence)) {
			throw new JsonPatchError('Patch sequence must be an array', 'SEQUENCE_NOT_AN_ARRAY');
		}

		if (document) {
			// clone document and sequence so that we can safely try applying operations
			applyPatch(deepClone(document), deepClone(sequence), externalValidator || true);
		} else {
			externalValidator = externalValidator || validator;
			for (let i = 0; i < sequence.length; i++) {
				externalValidator(sequence[i], i, document, undefined);
			}
		}
	} catch (e) {
		if (e instanceof JsonPatchError) {
			return e;
		}

		throw e;
	}
}

// based on https://github.com/epoberezkin/fast-deep-equal
// MIT License

// Copyright (c) 2017 Evgeny Poberezkin

// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.
function areEquals(a, b) {
	if (a === b) return true;

	if (a && b && typeof a === 'object' && typeof b === 'object') {
		const arrA = Array.isArray(a);
		const arrB = Array.isArray(b);
		let i;
		let length;
		let key;

		if (arrA && arrB) {
			length = a.length;
			if (length !== b.length) return false;
			for (i = length; i-- !== 0;) { if (!areEquals(a[i], b[i])) return false; }

			return true;
		}

		if (arrA !== arrB) return false;

		const keys = Object.keys(a);
		length = keys.length;

		if (length !== Object.keys(b).length) { return false; }

		for (i = length; i-- !== 0;) { if (!hasOwnProperty(b, keys[i])) return false; }

		for (i = length; i-- !== 0;) {
			key = keys[i];
			if (!areEquals(a[key], b[key])) return false;
		}

		return true;
	}

	// eslint-disable-next-line no-self-compare
	return a !== a && b !== b;
}
