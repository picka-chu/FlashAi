import axios from "axios";

async function test() {
  try {
    const res = await axios.get("https://v2.football.sportsapipro.com/api/live", {
      headers: { "x-api-key": process.env.FOOTBALL_API_KEY || "" }
    });
    console.log(JSON.stringify(res.data).substring(0, 2000));
  } catch (e) {
    console.error(e.message);
  }
}
test();
