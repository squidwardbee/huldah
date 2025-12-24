const https = require('https');

const query = `{
  userActivities(first: 10, orderBy: totalVolume, orderDirection: desc) {
    id
    totalVolume
    totalTrades
    profitLoss
  }
}`;

const data = JSON.stringify({ query });

const options = {
  hostname: 'api.goldsky.com',
  path: '/api/public/project_cl6mb8i9h0003e201j6li0diw/subgraphs/polymarket-activity-polygon/1.0.0/gn',
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
    console.log(JSON.stringify(JSON.parse(body), null, 2));
  });
});

req.write(data);
req.end();

