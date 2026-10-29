export function createReconnectScheduler(connect, setTimer = setTimeout, clearTimer = clearTimeout) {
  let timer = null;

  return {
    schedule(delayMs) {
      if (timer !== null) return false;
      timer = setTimer(() => {
        timer = null;
        connect();
      }, delayMs);
      return true;
    },
    cancel() {
      if (timer === null) return false;
      clearTimer(timer);
      timer = null;
      return true;
    },
    get pending() {
      return timer !== null;
    },
  };
}
