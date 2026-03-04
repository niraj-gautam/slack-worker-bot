const http = require('http');
const { execSync } = require('child_process');

const port = process.env.PORT || 3000;

http.createServer((_, res) => {
  res.writeHead(200);
  res.end('OK');
}).listen(port, () => {
  console.log(`[start] Health check on port ${port}`);

  try {
    console.log('[start] Running setup...');
    execSync('sh setup-repo.sh', { stdio: 'inherit' });
    console.log('[start] Setup done, starting bot...');
    require('./node_modules/ts-node').register({ transpileOnly: true });
    require('./src/app.ts');
  } catch (err) {
    console.error('[start] Fatal:', err);
    process.exit(1);
  }
});
