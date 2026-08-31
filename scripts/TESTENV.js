const open = require("open").default;

const urls = [
  "https://localhost:3000/html/movieInfo.html?id=1095&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=1429&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=12598&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=20450&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=30981&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=30984&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=30991&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=31724&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=31911&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=34186&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=37854&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=43865&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=45782&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=46279&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=50076&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=54310&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=60708&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=61374&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=61459&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=61752&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=63510&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=64196&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=65369&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=65942&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=67656&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=67676&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=69346&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=70036&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=73223&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=74185&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=80559&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=82591&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=82684&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=82739&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=83095&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=85937&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=94664&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=95479&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=96402&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=99618&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=100565&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=102086&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=105248&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=114410&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=117465&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=117884&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=118541&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=118821&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=119495&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=120089&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=120155&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=123528&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=127532&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=196950&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=197848&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=206630&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=207468&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=208493&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=209867&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=220542&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=250596&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=258348&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=260823&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=270603&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=274671&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=298994&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=312949&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=314554&type=tv",
  "https://localhost:3000/html/movieInfo.html?id=329020&type=tv"
];

async function run() {
  for (let i = 0; i < urls.length; i++) {
    console.log(`Opening ${i + 1}/${urls.length}: ${urls[i]}`);
    await open(urls[i]);
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  console.log("Done!");
}

run();