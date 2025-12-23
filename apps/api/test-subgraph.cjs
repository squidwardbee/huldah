const https = require('https');

// Introspect the schema
const query = `{
  __schema {
    queryType {
      fields {
        name
        type {
          name
          kind
        }
      }
    }
  }
}`;

const data = JSON.stringify({ query });

const options = {
  hostname: 'api.goldsky.com',
  path: '/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/pnl-subgraph/0.0.14/gn',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': data.length
  }
};

const req = https.request(options, (res) => {
  let body = '';
  res.on('data', (chunk) => body += chunk);
  res.on('end', () => {
    try {
      const result = JSON.parse(body);
      if (result.data && result.data.__schema) {
        console.log('Available query fields:');
        result.data.__schema.queryType.fields.forEach(f => {
          console.log(`  - ${f.name} (${f.type.name || f.type.kind})`);
        });
      } else {
        console.log(JSON.stringify(result, null, 2));
      }
    } catch (e) {
      console.log('Raw response:', body);
    }
  });
});

req.on('error', (e) => console.error(e));
req.write(data);
req.end();
