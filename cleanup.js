require("dotenv").config();
const { google } = require("googleapis");
const path = require("path");
const keyFilePath = process.env.NODE_ENV === "production" ? "/etc/secrets/ajensen-warranty-form-9879411c4c3c.json" : path.join(__dirname, "ajensen-warranty-form-9879411c4c3c.json");
