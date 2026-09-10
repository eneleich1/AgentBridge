/** A tiny async iterable used to expose callback/process protocols as events. */
class AsyncEventQueue {
  constructor() {
    this.values = [];
    this.waiters = [];
    this.done = false;
  }

  push(value) {
    if (this.done) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.values.push(value);
  }

  close() {
    if (this.done) return;
    this.done = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }

  async next() {
    if (this.values.length) return { value: this.values.shift(), done: false };
    if (this.done) return { value: undefined, done: true };
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  [Symbol.asyncIterator]() {
    return this;
  }
}

module.exports = { AsyncEventQueue };
