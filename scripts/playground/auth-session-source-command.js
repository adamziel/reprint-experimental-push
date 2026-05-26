export function buildAuthSessionSourceCommand({
  sourceUrl,
  username,
  applicationPassword,
}) {
  if (!sourceUrl || !username || !applicationPassword) {
    return '';
  }

  const payload = JSON.stringify({
    sourceUrl,
    username,
    applicationPassword,
  });

  return `${process.execPath} -e 'process.stdout.write(${JSON.stringify(payload)})'`;
}
