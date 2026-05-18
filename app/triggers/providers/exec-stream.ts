type ExecStream = {
  once?: (event: string, callback: (error?: unknown) => void) => void;
  removeListener: (event: string, callback: (error?: unknown) => void) => void;
};

export async function waitForExecStream(execStream: ExecStream): Promise<void> {
  await new Promise((resolve, reject) => {
    if (!execStream?.once) {
      resolve(undefined);
      return;
    }
    const onError = (error: unknown) => {
      execStream.removeListener('end', onDone);
      execStream.removeListener('close', onDone);
      reject(error);
    };
    const onDone = () => {
      execStream.removeListener('end', onDone);
      execStream.removeListener('close', onDone);
      execStream.removeListener('error', onError);
      resolve(undefined);
    };
    execStream.once('end', onDone);
    execStream.once('close', onDone);
    execStream.once('error', onError);
  });
}
