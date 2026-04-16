const axios = require('axios');

async function test() {
  try {
    const res = await axios.get("https://v2.football.sportsapipro.com/api/live", {
      headers: { "x-api-key": "cd225a94-3811-4d50-9f5d-0e1d458ddb0a" }
    });
    console.log(JSON.stringify(res.data).substring(0, 2000));
  } catch (e) {
    console.error(e.message);
  }
}
test();
