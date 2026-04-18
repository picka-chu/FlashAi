import axios from "axios";

async function test() {
  try {
    const apiKey = process.env.FOOTBALL_API_KEY || "YOUR_API_KEY_HERE";
    if (apiKey === "YOUR_API_KEY_HERE") {
      console.error("⚠️ Please set FOOTBALL_API_KEY environment variable");
      return;
    }
    const res = await axios.get("https://v2.football.sportsapipro.com/api/live", {
      headers: { "x-api-key": apiKey }
    });
    console.log(JSON.stringify(res.data).substring(0, 2000));
  } catch (e: any) {
    console.error(e.message);
  }
}
test();
