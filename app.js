const protoo = require("protoo-server");
const mediasoup = require("mediasoup");
//const http = require("http");
const https = require("https");
const express = require("express");
const url = require("url");
const os = require("os");
const Room = require("./Room");
const config = require("./config");
const { AwaitQueue } = require("awaitqueue");
const fs = require("fs");
const rooms = new Map();
const queue = new AwaitQueue();
const mediasoupWorkers = [];
var cors = require('cors');
let nextMediasoupWorkerIdx = 0;
let httpsServer;
let expressApp;
run();

async function run() {
  await runMediasoupWorkers();
  await runHttpServer();
  await runProtooWebSocketServer();
}

async function runHttpServer() {
  expressApp = express();
  //expressApp.get(
//		'/check', (req, res) =>
//		{
//			res.status(200).send("hello@@@@@@@@@@@@@@@@@@");
//		});
  const tls =
	{
		cert : fs.readFileSync(config.https.tls.cert),
		key  : fs.readFileSync(config.https.tls.key)
	};
  httpsServer = https.createServer(tls,expressApp);

//   httpsServer.listen(4443, () => {
//     console.log("start"); 
//  });
  await new Promise((resolve) =>
	{
		httpsServer.listen(
			Number(config.https.listenPort), config.https.listenIp, resolve);
	});
}
async function runMediasoupWorkers() {
  const { numWorkers } = config.mediasoup;

  for (let i = 0; i < numWorkers; ++i) {
    const worker = await mediasoup.createWorker({
      //   logLevel: config.mediasoup.workerSettings.logLevel,
      //   logTags: config.mediasoup.workerSettings.logTags,
         rtcMinPort: Number(config.mediasoup.workerSettings.rtcMinPort),
         rtcMaxPort: Number(config.mediasoup.workerSettings.rtcMaxPort),
      //rtcMinPort: 2000,
      //rtcMaxPort: 2020,
    });

    worker.on("died", () => {
      setTimeout(() => process.exit(1), 2000);
    });

    mediasoupWorkers.push(worker);

    // Log worker resource usage every X seconds.
    setInterval(async () => {
      const usage = await worker.getResourceUsage();
    }, 120000);
  }
}

async function runProtooWebSocketServer() {
  console.log("running");

  protooWebSocketServer = new protoo.WebSocketServer(httpsServer, {
    maxReceivedFrameSize: 960000, // 960 KBytes.
    maxReceivedMessageSize: 960000,
    fragmentOutgoingMessages: true,
    fragmentationThreshold: 960000,
  });

  protooWebSocketServer.on("connectionrequest", (info, accept, reject) => {
    // The client indicates the roomId and peerId in the URL query.
    console.log("connect");
    const u = url.parse(info.request.url, true);
    const roomId = u.query["room"];
    const peerId = u.query["peer"];
    const role = u.query["role"];

    if (!roomId || !peerId) {
      reject(400, "Connection request without roomId and/or peerId");

      return;
    }

    queue
      .push(async () => {
        const room = await getOrCreateRoom({ roomId });

        // Accept the protoo WebSocket connection.
        const protooWebSocketTransport = accept();

        // 일단 역할을 요청 url에 넣어둠
        const consume = role === "produce" ? false : true;
        room.handleProtooConnection({
          peerId,
          consume,
          protooWebSocketTransport,
        });
      })
      .catch((error) => {
        reject(error);
      });
  });
}

function getMediasoupWorker() {
  const worker = mediasoupWorkers[nextMediasoupWorkerIdx];

  if (++nextMediasoupWorkerIdx === mediasoupWorkers.length)
    nextMediasoupWorkerIdx = 0;

  return worker;
}

async function getOrCreateRoom({ roomId }) {
  let room = rooms.get(roomId);

  // If the Room does not exist create a new one.
  if (!room) {
    console.log("here");

    const mediasoupWorker = getMediasoupWorker();

    try {
      room = await Room.create({ mediasoupWorker, roomId });
    } catch (error) {
      console.log(error.message);
    }

    rooms.set(roomId, room);
    // event emitter 상속후 가능?
    // room.on("close", () => rooms.delete(roomId));
  }

  return room;
}
