// --- 1. MQTT Configuration (Copy from your script.js) ---
const MQTT_CONFIG = {
    host: '4809a06803844080a705e76187cf49ce.s1.eu.hivemq.cloud',
    port: 8884,
    username: 'DC_Motor', // Use the same username
    password: 'EWS_Lab4', // Use the same password
    // *** IMPORTANT: Use a DIFFERENT clientId ***
    clientId: 'car-simulator-' + Math.random().toString(16).substr(2, 8)
};

// --- 2. MQTT Topics (Copy from your script.js) ---
const TOPICS = {
    MOTOR_DATA: 'esp32/motor/data',
    MOTOR_CONTROL: 'esp32/motor/control',
    MOTOR_STATUS: 'esp32/motor/status'
};

// --- 3. Simulation State ---
const sim = {
    // Car's physical state
    x: 400,
    y: 300,
    speed: 0,
    angle: 0,              // radians

    // Motor & turn targets
    targetRPM: 0,
    remainingTurnDeg: 0,   // degrees left in current relative turn
    lastCommandDeg: 0,     // last relative turn command value

    // Current simulated motor values
    currentRPM: 0,
    headingDeg: 0,         // accumulated heading (deg)
    wheelAngle: 0          // steering wheel visual angle
};

const CAR = {
    width: 40,
    height: 20
};

// --- 4. Canvas Setup ---
const canvas = document.getElementById('simCanvas');
const ctx = canvas.getContext('2d');

// --- 5. MQTT Connection ---
let mqttClient = null;
const connectUrl = `wss://${MQTT_CONFIG.host}:${MQTT_CONFIG.port}/mqtt`;

try {
    mqttClient = mqtt.connect(connectUrl, {
        clientId: MQTT_CONFIG.clientId,
        username: MQTT_CONFIG.username,
        password: MQTT_CONFIG.password,
        connectTimeout: 4000
    });

    mqttClient.on('connect', () => {
        console.log('SIM: Connected to MQTT broker');
        // We LISTEN for control commands
        mqttClient.subscribe(TOPICS.MOTOR_CONTROL, (err) => {
            if (!err) console.log(`SIM: Subscribed to ${TOPICS.MOTOR_CONTROL}`);
        });
        // We also publish our status
        publishStatus('Car simulator online');
    });

    mqttClient.on('error', (err) => console.error('SIM: MQTT Error:', err));
    mqttClient.on('close', () => console.log('SIM: MQTT connection closed'));

    // --- 6. *** This is the Core Logic *** ---
    // Handle incoming commands from the dashboard
    mqttClient.on('message', (topic, message) => {
        if (topic === TOPICS.MOTOR_CONTROL) {
            try {
                const cmd = JSON.parse(message.toString());
                
                // Got an RPM command
                if (cmd.targetRPM !== undefined) {
                    sim.targetRPM = cmd.targetRPM;
                    console.log(`SIM: New RPM command: ${sim.targetRPM}`);
                }
                
                // Relative turn command (dashboard sends targetAngle; treat it as delta)
                if (cmd.targetAngle !== undefined) {
                    sim.lastCommandDeg = cmd.targetAngle;
                    sim.remainingTurnDeg = cmd.targetAngle; // overwrite any in-progress turn
                    console.log(`SIM: Relative turn request: ${cmd.targetAngle}° from current heading ${sim.headingDeg.toFixed(1)}°`);
                }
                // Support explicit relative key turnAngle as synonym
                if (cmd.turnAngle !== undefined) {
                    sim.lastCommandDeg = cmd.turnAngle;
                    sim.remainingTurnDeg = cmd.turnAngle;
                    console.log(`SIM: Relative turn (turnAngle key): ${cmd.turnAngle}°`);
                }
                
            } catch (e) {
                console.error('SIM: Error parsing command', e);
            }
        }
    });

} catch (error) {
    console.error('SIM: Failed to connect to MQTT:', error);
}

// --- 7. Simulation "Game Loop" ---
let lastTime = 0;
function gameLoop(timestamp) {
    const deltaTime = (timestamp - lastTime) / 1000; // Time in seconds
    lastTime = timestamp;

    update(deltaTime || 0); // Update physics
    draw();                 // Draw the car
    
    requestAnimationFrame(gameLoop); // Repeat
}

// --- 8. Update Physics ---
function update(dt) {
    // Helpers
    const deg2rad = d => d * Math.PI / 180;
    const rad2deg = r => r * 180 / Math.PI;

    // 1. Smooth RPM to target
    sim.currentRPM += (sim.targetRPM - sim.currentRPM) * 0.08; // slightly snappier
    const MAX_SPEED_FACTOR = 0.5; 
    sim.speed = sim.currentRPM * MAX_SPEED_FACTOR;

    // 2. Handle relative turn consumption
    const TURN_SPEED_DEG_PER_SEC = 90; // rotate at 90°/sec
    if (Math.abs(sim.remainingTurnDeg) > 0.01) {
        const direction = Math.sign(sim.remainingTurnDeg);
        const deltaDeg = Math.min(Math.abs(sim.remainingTurnDeg), TURN_SPEED_DEG_PER_SEC * dt);
        sim.angle += deg2rad(direction * deltaDeg);
        sim.headingDeg += direction * deltaDeg;
        sim.remainingTurnDeg -= direction * deltaDeg;
        const targetWheel = direction * 35;
        sim.wheelAngle += (targetWheel - sim.wheelAngle) * 0.25;
    } else {
        sim.wheelAngle += (0 - sim.wheelAngle) * 0.25;
    }

    // 3. Update position based on heading and speed
    sim.x += Math.cos(sim.angle) * sim.speed * dt;
    sim.y += Math.sin(sim.angle) * sim.speed * dt;

    // 4. Wrap-around boundaries
    if (sim.x < 0) sim.x = canvas.width;
    if (sim.x > canvas.width) sim.x = 0;
    if (sim.y < 0) sim.y = canvas.height;
    if (sim.y > canvas.height) sim.y = 0;

    // 5. Update status panel values
    updateStatus(sim.headingDeg);
}

// --- 9. Draw Graphics ---
function draw() {
    // Clear the screen
    ctx.fillStyle = '#444';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Save canvas state
    ctx.save();
    
    // Move to the car's position and apply rotation
    ctx.translate(sim.x, sim.y);
    ctx.rotate(sim.angle);

    // Draw the car body (a rectangle)
    ctx.fillStyle = '#e94560'; // Red color
    ctx.fillRect(-CAR.width / 2, -CAR.height / 2, CAR.width, CAR.height);
    
    // Draw "headlight" (to show direction)
    ctx.fillStyle = 'yellow';
    ctx.fillRect(CAR.width / 2 - 5, -3, 5, 6);

    // Restore canvas state
    ctx.restore();
}

// --- 10. Publish Simulated Data Back to Dashboard ---
function publishData() {
    if (!mqttClient || !mqttClient.connected) return;

    const data = {
        currentRPM: sim.currentRPM,
        targetRPM: sim.targetRPM,
        pwmValue: (sim.currentRPM / 350) * 255,
        currentAngle: sim.headingDeg,              // absolute heading for dashboard
        targetAngle: sim.headingDeg + sim.remainingTurnDeg, // future heading endpoint
        remainingTurnDeg: sim.remainingTurnDeg,     // relative degrees left
        lastCommandDeg: sim.lastCommandDeg,         // last relative request
        wheelAngle: sim.wheelAngle,
        headingDeg: sim.headingDeg,
        Kp: 1.0, Ki: 5.0, Kd: 0.05
    };

    mqttClient.publish(TOPICS.MOTOR_DATA, JSON.stringify(data));
}

function publishStatus(status) {
    if (!mqttClient || !mqttClient.connected) return;
    const payload = JSON.stringify({ status: status });
    mqttClient.publish(TOPICS.MOTOR_STATUS, payload);
}

// Start the simulation loop
requestAnimationFrame(gameLoop);

// Publish data back to the dashboard 2 times per second (like the ESP32)
setInterval(publishData, 500);

// --- 11. UI Controls (optional for local testing) ---
function sendControl(payload) {
    if (!mqttClient || !mqttClient.connected) return;
    mqttClient.publish(TOPICS.MOTOR_CONTROL, JSON.stringify(payload));
}

const rpmInput = document.getElementById('rpmInput');
const angleInput = document.getElementById('angleInput');
const sendRPMBtn = document.getElementById('sendRPMBtn');
const sendAngleBtn = document.getElementById('sendAngleBtn');

if (sendRPMBtn) {
    sendRPMBtn.addEventListener('click', () => {
        const val = parseFloat(rpmInput.value);
        if (!isNaN(val)) sendControl({ targetRPM: val });
    });
}
if (sendAngleBtn) {
    sendAngleBtn.addEventListener('click', () => {
        const val = parseFloat(angleInput.value);
        if (!isNaN(val)) sendControl({ targetAngle: val }); // absolute heading from local test control
    });
}

// --- 12. Status Panel Update ---
function updateStatus(headingDeg) {
    const currentRPMEl = document.getElementById('currentRPMValue');
    const targetRPMEl = document.getElementById('targetRPMValue');
    const headingEl = document.getElementById('headingValue');
    const remainingEl = document.getElementById('remainingTurnValue');
    if (!currentRPMEl) return; // panel not loaded yet
    currentRPMEl.textContent = sim.currentRPM.toFixed(0);
    targetRPMEl.textContent = sim.targetRPM.toFixed(0);
    headingEl.textContent = ((headingDeg % 360) + 360).toFixed(0) % 360; // normalize
    remainingEl.textContent = sim.remainingTurnDeg.toFixed(1);
}