"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDatabaseLock = createDatabaseLock;
function createDatabaseLock() {
    let tail = Promise.resolve();
    return (task) => {
        const result = tail.then(task, task);
        tail = result.catch(() => undefined);
        return result;
    };
}
