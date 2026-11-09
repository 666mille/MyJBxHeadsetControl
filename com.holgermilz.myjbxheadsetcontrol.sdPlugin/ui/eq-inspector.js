// Shows the EQ engine status in the property inspector
const { streamDeckClient } = SDPIComponents;
streamDeckClient.sendToPropertyInspector.subscribe((msg) => {
    const p = msg.payload;
    if (!p || p.event !== "engineStatus") return;
    const el = document.getElementById("engine");
    el.className = p.ok ? "ok" : "err";
    el.textContent = !p.ok ? ("Locked: " + p.error)
        : p.mode === "service" ? "Ready (via QuantumENGINE)"
        : "Ready (own engine, self-test OK)";
});
