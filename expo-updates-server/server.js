const { createServer: createHttpsServer } = require('https');
const { createServer: createHttpServer } = require('http');
const { parse } = require('url');
const next = require('next');
const fs = require('fs');
const path = require('path');

const dev = process.env.NODE_ENV !== 'production';
const hostname = '0.0.0.0';
const port = parseInt(process.env.PORT, 10) || 3000;

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

// SSL certificate paths from environment variables
const sslCertPath = process.env.SSL_CERT_PATH;
const sslKeyPath = process.env.SSL_KEY_PATH;
const sslCaPath = process.env.SSL_CA_PATH;

function loadSSLCerts() {
  if (!sslCertPath || !sslKeyPath) {
    return null;
  }

  try {
    const options = {
      cert: fs.readFileSync(path.resolve(sslCertPath)),
      key: fs.readFileSync(path.resolve(sslKeyPath)),
    };

    if (sslCaPath) {
      options.ca = fs.readFileSync(path.resolve(sslCaPath));
    }

    return options;
  } catch (err) {
    console.error('Error loading SSL certificates:', err.message);
    console.error('Falling back to HTTP...');
    return null;
  }
}

app.prepare().then(() => {
  const sslOptions = loadSSLCerts();

  const requestHandler = (req, res) => {
    const parsedUrl = parse(req.url, true);
    handle(req, res, parsedUrl);
  };

  if (sslOptions) {
    createHttpsServer(sslOptions, requestHandler).listen(port, hostname, () => {
      console.log(`> HTTPS server running on https://${hostname}:${port}`);
    });
  } else {
    createHttpServer(requestHandler).listen(port, hostname, () => {
      console.log(`> HTTP server running on http://${hostname}:${port}`);
      if (!dev) {
        console.warn('> WARNING: Running in production without SSL!');
      }
    });
  }
});
