import axios from "axios";

async function test() {
  try {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const res = await axios.get("https://v2.football.sportsapipro.com/api/matches", {
      headers: { "x-api-key": "cd225a94-3811-4d50-9f5d-0e1d458ddb0a" },
      params: { date: d.toISOString().split('T')[0] }
    });
    console.log(JSON.stringify(res.data).substring(0, 2000));
  } catch (e: any) {
    console.error(e.response ? e.response.status + " " + e.response.statusText : e.message);
  }
}
test();
