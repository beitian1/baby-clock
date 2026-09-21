/* 宝贝闹钟 一体化服务：静态文件 + 同源 PeerJS 信令（/peerjs） */
import express from "express";
import { ExpressPeerServer } from "peer";
import { fileURLToPath } from "url";
import path from "path";

const root = path.dirname(fileURLToPath(import.meta.url));
const app = express();
app.use(express.static(root, { extensions: ["html"] }));

const PORT = process.env.PORT || 8000;
const server = app.listen(PORT, "0.0.0.0", () => console.log("宝贝闹钟服务已启动: http://0.0.0.0:" + PORT + " （信令 /peerjs）"));

const peerServer = ExpressPeerServer(server, {
  proxied: true,         // 信任 X-Forwarded-*（Cloudflare 隧道）
  allow_discovery: false,
  path: "/",
});
app.use(peerServer); /* 客户端默认 path="/" 时信令端点即 /peerjs，须挂根路径 */
