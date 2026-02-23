import React, { useState, useRef, useEffect } from "react";
import "../App.css";
import virtualspace from "../assets/virtualspace.png";

export default function OutputView({ onClose }) {
  // create 4 default dialogue icons positioned around the 512x512 canvas
  const createIcons = () => {
    return [
      {
        id: 1,
        x: 130,
        y: 95,
        name: "Camera1",
        type: "read",
        connectedComponent: "CameraInput",
        bindVar: "visionaiData.camera1",
        labelTemplate: "{{status}}",
        dialogTemplate: "Camera1: {{message}}",
      },
      {
        id: 2,
        x: 173,
        y: 162,
        name: "Machine1",
        type: "read",
        connectedComponent: "CameraInput",
        bindVar: "visionaiData.Machine1",
        labelTemplate: "{{status}}",
        dialogTemplate: "Machine1: {{message}}",
      },
      {
        id: 3,
        x: 351,
        y: 204,
        name: "Monitor",
        type: "read",
        connectedComponent: "CameraInput",
        bindVar: "visionaiData.Monitor",
        labelTemplate: "{{status}}",
        dialogTemplate: "Monitor: {{message}}",
      },
      {
        id: 4,
        x: 328,
        y: 341,
        name: "EngineerA",
        type: "thinking",
        connectedComponent: "CameraInput",
        bindVar: "visionaiData.EngineerA",
        labelTemplate: "{{status}}",
        dialogTemplate: "EngineerA: {{message}}",
      },
    ];
  };

  const [icons, setIcons] = useState(createIcons);
  const draggingRef = useRef(null);
  const movedRef = useRef({});
  const demoRef = useRef(null);
  const [isDemoPlaying, setIsDemoPlaying] = useState(false);

  const onPointerDownIcon = (e, icon) => {
    e.stopPropagation();
    const pointerId = e.pointerId;
    e.currentTarget.setPointerCapture(pointerId);
    const startX = e.clientX;
    const startY = e.clientY;
    draggingRef.current = { id: icon.id, startX, startY, initX: icon.x, initY: icon.y, pointerId };
    movedRef.current[icon.id] = false;
  };

  const onPointerMoveIcon = (e, icon) => {
    if (!draggingRef.current || draggingRef.current.id !== icon.id) return;
    const { startX, startY, initX, initY } = draggingRef.current;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    const newX = Math.round(initX + dx);
    const newY = Math.round(initY + dy);
    // clamp inside 0..(512-48)
    const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
    const clampedX = clamp(newX, 0, 512 - 48);
    const clampedY = clamp(newY, 0, 512 - 48);
    setIcons((prev) => prev.map((it) => (it.id === icon.id ? { ...it, x: clampedX, y: clampedY } : it)));
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) movedRef.current[icon.id] = true;
  };

  const onPointerUpIcon = (e, icon) => {
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (err) {}
    draggingRef.current = null;
    // small timeout to allow click event to read movedRef
    setTimeout(() => {
      movedRef.current[icon.id] = false;
    }, 0);
    // log current icon positions so user can copy defaults
    try {
      console.log(
        "dialogue icon positions:",
        JSON.stringify(icons.map((i) => ({ id: i.id, x: i.x, y: i.y, name: i.name })), null, 2)
      );
    } catch (err) {
      console.log("dialogue icon positions:", icons);
    }
  };

  const onClickIcon = (icon) => {
    // ignore clicks that were part of a drag
    if (movedRef.current[icon.id]) return;
    const name = window.prompt("Enter name for this icon:", icon.name || "");
    if (name !== null) {
      setIcons((prev) => prev.map((it) => (it.id === icon.id ? { ...it, name } : it)));
    }
  };

  const getRandomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  const pickStatusFor = (name) => {
    const n = (name || "").toLowerCase();
    if (n.includes("camera")) {
      const opts = [
        `Idle`,
        `Capturing`,
        `Capturing frame #${getRandomInt(1, 999)}`,
        `Idle / every ${getRandomInt(5, 15)}s, capturing`,
      ];
      return opts[getRandomInt(0, opts.length - 1)];
    }
    if (n.includes("machine")) {
      const temp = getRandomInt(60, 90);
      const pressure = getRandomInt(900, 1100);
      const opts = [
        `Running...`,
        `Temperature ${temp}°C`,
        `Pressure ${pressure} mBar`,
        `Running... / Temp ${temp}°C / Pressure ${pressure}mBar`,
      ];
      return opts[getRandomInt(0, opts.length - 1)];
    }
    if (n.includes("monitor")) {
      const opts = [`System Normal running`, `System idle...`, `No issues detected`];
      return opts[getRandomInt(0, opts.length - 1)];
    }
    if (n.includes("engineer") || n.includes("eng")) {
      const opts = [`I am monitoring the system`, `Checking sensors...`, `All systems nominal`];
      return opts[getRandomInt(0, opts.length - 1)];
    }
    // generic
    const opts = ["Active", "Idle", "OK", "Working...", "Waiting..."];
    return opts[getRandomInt(0, opts.length - 1)];
  };

  const tickDemo = () => {
    setIcons((prev) =>
      prev.map((icon) => {
        const line1 = icon.name && icon.name.length ? icon.name : `Icon${icon.id}`;
        const line2 = pickStatusFor(icon.name);
        return { ...icon, dialogueLine1: line1, dialogueLine2: line2 };
      })
    );
  };

  const startDemo = () => {
    if (demoRef.current) return;
    tickDemo();
    demoRef.current = setInterval(tickDemo, 2000);
    setIsDemoPlaying(true);
  };

  const stopDemo = () => {
    if (demoRef.current) {
      clearInterval(demoRef.current);
      demoRef.current = null;
    }
    setIsDemoPlaying(false);
  };

  useEffect(() => {
    return () => {
      // cleanup on unmount
      if (demoRef.current) {
        clearInterval(demoRef.current);
        demoRef.current = null;
      }
    };
  }, []);

  const copyPositions = async () => {
    const data = icons.map((i) => ({ id: i.id, x: i.x, y: i.y, name: i.name }));
    const snippet = JSON.stringify(data, null, 2);
    try {
      if (navigator && navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(snippet);
        console.log("Copied positions to clipboard:", snippet);
        return;
      }
    } catch (err) {
      // ignore
    }
    // fallback: log to console
    console.log("Positions (copy manually):", snippet);
  };

  return (
    <div className="output-view" role="region" aria-label="Output View">
      <div className="output-header">
        <div style={{ display: "flex", gap: 8 }}>
          <button className="close-output" onClick={onClose}>
            Close
          </button>
          <button className="close-output" onClick={copyPositions}>
            Copy Positions
          </button>
          <button className="close-output" onClick={() => (isDemoPlaying ? stopDemo() : startDemo())}>
            {isDemoPlaying ? "Stop Demo" : "Play Demo"}
          </button>
        </div>
      </div>
      <div
        className="output-body"
        style={{
          backgroundImage: `url(${virtualspace})`,
          backgroundSize: "512px 512px",
          backgroundPosition: "center",
          backgroundRepeat: "no-repeat",
        }}
      >
        {icons.map((icon) => (
          <div
            key={icon.id}
            className="dialogue-icon"
            style={{ left: icon.x, top: icon.y }}
            onPointerDown={(e) => onPointerDownIcon(e, icon)}
            onPointerMove={(e) => onPointerMoveIcon(e, icon)}
            onPointerUp={(e) => onPointerUpIcon(e, icon)}
            onClick={() => onClickIcon(icon)}
          >
            <div className="dialogue-main" aria-hidden>
              <svg width="20" height="20" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10z"
                  fill="#ffffff"
                  stroke="#000000"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
            <div className="dialogue-bubble">
              <div className="dialogue-bubble-line1">{icon.dialogueLine1 || (icon.name || "")}</div>
              <div className="dialogue-bubble-line2">{icon.dialogueLine2 || ""}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
