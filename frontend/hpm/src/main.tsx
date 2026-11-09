import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "react-router-dom";
import { AuthProvider } from "./context/AuthProvider";
import { RecordingProvider } from "./context/RecordingProvider";
import router from "./routes";
import "pretendard/dist/web/variable/pretendardvariable.css";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AuthProvider>
      <RecordingProvider>
        <RouterProvider router={router} />
      </RecordingProvider>
    </AuthProvider>
  </StrictMode>
);
