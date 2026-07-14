const { streamDeckClient } = SDPIComponents;

function updateStatus(payload) {
    const statusBox = document.getElementById("statusBox");
    const errorBox = document.getElementById("deviceError");

    if (payload.connected) {
        statusBox.textContent = `Connected — Battery: ${payload.battery}%`;
        errorBox.style.display = "none";
    } else {
        statusBox.textContent = "";
        errorBox.style.display = "block";
    }
}

// Auf spätere Updates vom Plugin hören
streamDeckClient.sendToPropertyInspector.subscribe((response) => {
    updateStatus(response.payload);
});

// Aktiv den aktuellen Status anfragen, sobald diese Seite fertig geladen ist
streamDeckClient.send("sendToPlugin", { event: "getStatus" });