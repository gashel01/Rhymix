import React from "react";
import ReactDOM from "react-dom/client";
import axios from "axios";
import NextApp from "./next/NextApp";
import { installApiBaseInterceptors } from "./utils/apiBase";

installApiBaseInterceptors(axios);

const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(<NextApp />);
