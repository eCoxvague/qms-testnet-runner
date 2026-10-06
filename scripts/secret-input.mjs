export function readSecret(label, { input = process.stdin, output = process.stdout } = {}) {
  if (!input.isTTY || typeof input.setRawMode !== 'function')
    return Promise.reject(new Error('Gizli giris icin interaktif terminal acin. Anahtari komut argumanina yazmayin.'));
  return new Promise((accept, reject) => {
    let value = '';
    const wasRaw = Boolean(input.isRaw);
    output.write(label + ': ');
    input.setEncoding('utf8');
    input.setRawMode(true);
    input.resume();
    function cleanup() {
      input.off('data', onData);
      input.off('end', onEnd);
      input.setRawMode(wasRaw);
      input.pause();
      output.write('\n');
    }
    function onEnd() { cleanup(); value = ''; reject(new Error('Gizli giris iptal edildi.')); }
    function onData(chunk) {
      for (const character of chunk) {
        if (character === '\u0003' || character === '\u0004') { onEnd(); return; }
        if (character === '\r' || character === '\n') {
          cleanup(); const result = value; value = ''; accept(result); return;
        }
        if (character === '\u007f' || character === '\b') {
          if (value.length) { value = value.slice(0, -1); output.write('\b \b'); }
        } else if (character >= ' ') { value += character; output.write('*'); }
      }
    }
    input.on('data', onData);
    input.once('end', onEnd);
  });
}
