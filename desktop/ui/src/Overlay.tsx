import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useState } from "react";
import logo from "./assets/logo.png";

function describeBlockEvent(message: string) {
  if (message.startsWith("block:app:")) {
    return `Blocked app: ${message.slice("block:app:".length)}`;
  }

  if (message.startsWith("block:dns:")) {
    return `Blocked domain: ${message.slice("block:dns:".length)}`;
  }

  if (message === "block:app") {
    return "Blocked app";
  }

  if (message === "block:dns") {
    return "Blocked domain";
  }

  return "Blocked content";
}

export function Overlay() {
  const [blockReason, setBlockReason] = useState("Blocked content");

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    invoke<string | null>("get_last_block_event")
      .then((message) => {
        if (message) {
          setBlockReason(describeBlockEvent(message));
        }
      })
      .catch(() => {});

    listen<string>("block-event", (event) => {
      setBlockReason(describeBlockEvent(event.payload));
    }).then((cleanup) => {
      unlisten = cleanup;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  const closeOverlay = async () => {
    await invoke("hide_overlay");
  };

  return (
    <div className="overlay-root">
      <div className="overlay-content">
        <img src={logo} alt="LibreAscent" style={{ width: '64px', height: '64px', marginBottom: '24px' }} />
        <p className="eyebrow">LibreAscent</p>
        <h1>Content Blocked</h1>
        <p className="block-reason">{blockReason}</p>
        <p className="message">
          This application or website has been blocked to help you stay focused.
        </p>
        <button className="btn-close" onClick={closeOverlay}>
          Go back to work
        </button>
      </div>
    </div>
  );
}
