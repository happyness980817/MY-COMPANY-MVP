import express from "express";
import { home, postCreate, postEnter, room } from "../controllers/roomController.js";

const router = express.Router();

router.get("/", home);
router.post("/create", postCreate);
router.post("/enter", postEnter);
router.get("/room", room);

export default router;
