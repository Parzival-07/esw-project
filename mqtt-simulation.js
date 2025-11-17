// MQTT Configuration
const MQTT_CONFIG = {
    host: '4809a06803844080a705e76187cf49ce.s1.eu.hivemq.cloud',
    port: 8884,
    username: 'DC_Motor',
    password: 'EWS_Lab4',
    clientId: 'car-sim-' + Math.random().toString(16).substr(2, 8)
};

const TOPICS = {
    MOTOR_DATA: 'esp32/motor/data',
    MOTOR_CONTROL: 'esp32/motor/control',
    MOTOR_STATUS: 'esp32/motor/status'
};

// Car state - driven purely by MQTT data
let carState = {
    x: 0,              // Car position X
    y: 0,              // Car position Y
    angle: 0,          // Car orientation (degrees)
    targetRPM: 0,      // From MQTT
    targetAngle: 0,    // From MQTT
    speed: 0           // Calculated from RPM
};

// Canvas and rendering
let canvas, ctx;
let animationId;

// MQTT Client
let mqttClient = null;

// Initialize everything when page loads
document.addEventListener('DOMContentLoaded', function() {
    initializeCanvas();
    initializeMQTT();
    startAnimation();
});

// Canvas setup
function initializeCanvas() {
    canvas = document.getElementById('simulationCanvas');
    ctx = canvas.getContext('2d');
    
    // Set canvas size
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    
    // Center the car initially
    carState.x = canvas.width / 2;
    carState.y = canvas.height / 2;
}

function resizeCanvas() {
    const container = document.getElementById('canvas-container');
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    
    // Recenter car if it was at default position
    if (carState.x === 0 && carState.y === 0) {
        carState.x = canvas.width / 2;
        carState.y = canvas.height / 2;
    }
}

// MQTT Connection
function initializeMQTT() {
    console.log('Connecting to MQTT broker...');
    
    const options = {
        clientId: MQTT_CONFIG.clientId,
        username: MQTT_CONFIG.username,
        password: MQTT_CONFIG.password,
        connectTimeout: 4000,
        reconnectPeriod: 1000,
    };

    const connectUrl = `wss://${MQTT_CONFIG.host}:${MQTT_CONFIG.port}/mqtt`;
    
    try {
        mqttClient = mqtt.connect(connectUrl, options);
        
        mqttClient.on('connect', function() {
            console.log('Connected to MQTT broker');
            updateConnectionStatus(true);
            subscribeToTopics();
        });
        
        mqttClient.on('error', function(error) {
            console.error('MQTT connection error:', error);
            updateConnectionStatus(false);
        });
        
        mqttClient.on('close', function() {
            console.log('MQTT connection closed');
            updateConnectionStatus(false);
        });
        
        mqttClient.on('message', function(topic, message) {
            handleMQTTMessage(topic, message.toString());
        });
        
    } catch (error) {
        console.error('Failed to connect to MQTT:', error);
        updateConnectionStatus(false);
    }
}

function subscribeToTopics() {
    if (!mqttClient) return;
    
    mqttClient.subscribe([TOPICS.MOTOR_DATA, TOPICS.MOTOR_CONTROL], function(err) {
        if (!err) {
            console.log('Subscribed to motor data and control topics');
        } else {
            console.error('Failed to subscribe:', err);
        }
    });
}

function updateConnectionStatus(connected) {
    const statusEl = document.getElementById('connectionStatus');
    if (connected) {
        statusEl.textContent = '✓ Connected to MQTT';
        statusEl.className = 'connection-status connected';
    } else {
        statusEl.textContent = '✗ Disconnected from MQTT';
        statusEl.className = 'connection-status disconnected';
    }
}

// Handle incoming MQTT messages
function handleMQTTMessage(topic, message) {
    try {
        const data = JSON.parse(message);
        console.log(`Received message from ${topic}:`, data);
        
        // Handle control commands (these trigger immediate actions)
        if (topic === TOPICS.MOTOR_CONTROL) {
            // RPM command
            if (data.targetRPM !== undefined) {
                carState.targetRPM = data.targetRPM;
                carState.speed = data.targetRPM / 100; // Convert to pixel speed
            }
            
            // Angle command - ALWAYS apply as relative rotation
            if (data.targetAngle !== undefined) {
                const incomingDelta = Number(data.targetAngle);
                if (!Number.isNaN(incomingDelta)) {
                    carState.targetAngle = incomingDelta; // display last command
                    // Apply rotation relative to current heading
                    carState.angle += incomingDelta;
                    // Normalize to [0, 360)
                    carState.angle = ((carState.angle % 360) + 360) % 360;
                    console.log(`Rotating by ${incomingDelta}°, new heading: ${carState.angle.toFixed(1)}°`);
                }
            }
            
            updateDisplay();
        }
        
        // Handle motor data updates (feedback from ESP32)
        if (topic === TOPICS.MOTOR_DATA) {
            // Update RPM from feedback
            if (data.targetRPM !== undefined) {
                carState.targetRPM = data.targetRPM;
                carState.speed = data.targetRPM / 100;
            }
            
            // For angle, just update display value, don't rotate again
            if (data.targetAngle !== undefined) {
                carState.targetAngle = data.targetAngle;
            }
            
            updateDisplay();
        }
    } catch (error) {
        console.error('Error parsing MQTT message:', error);
    }
}

function updateDisplay() {
    document.getElementById('targetRPM').textContent = carState.targetRPM.toFixed(1);
    document.getElementById('targetAngle').textContent = carState.targetAngle.toFixed(1) + '°';
    document.getElementById('carSpeed').textContent = carState.speed.toFixed(1);
    document.getElementById('carAngle').textContent = carState.angle.toFixed(1) + '°';
}

// Animation loop
function startAnimation() {
    function animate() {
        updateCarPosition();
        render();
        animationId = requestAnimationFrame(animate);
    }
    animate();
}

function updateCarPosition() {
    // Move car based on current speed and angle
    // Convert angle to radians (0° = right, 90° = down)
    const angleRad = (carState.angle * Math.PI) / 180;
    
    // Update position based on speed and angle
    carState.x += carState.speed * Math.cos(angleRad);
    carState.y += carState.speed * Math.sin(angleRad);
    
    // Wrap around screen edges
    if (carState.x < -50) carState.x = canvas.width + 50;
    if (carState.x > canvas.width + 50) carState.x = -50;
    if (carState.y < -50) carState.y = canvas.height + 50;
    if (carState.y > canvas.height + 50) carState.y = -50;
}

function render() {
    // Clear canvas
    ctx.fillStyle = '#f8fafc';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    // Draw grid
    drawGrid();
    
    // Draw car
    drawCar();
    
    // Draw info
    drawInfo();
}

function drawGrid() {
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
    
    // Vertical lines
    for (let x = 0; x < canvas.width; x += 50) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
    }
    
    // Horizontal lines
    for (let y = 0; y < canvas.height; y += 50) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
    }
}

function drawCar() {
    ctx.save();
    ctx.translate(carState.x, carState.y);
    ctx.rotate((carState.angle * Math.PI) / 180);
    
    // Car body
    ctx.fillStyle = '#667eea';
    ctx.fillRect(-25, -15, 50, 30);
    
    // Car front (to show direction)
    ctx.fillStyle = '#764ba2';
    ctx.beginPath();
    ctx.moveTo(25, 0);
    ctx.lineTo(35, -10);
    ctx.lineTo(35, 10);
    ctx.closePath();
    ctx.fill();
    
    // Wheels
    ctx.fillStyle = '#1f2937';
    ctx.fillRect(-20, -18, 12, 6);  // Top left wheel
    ctx.fillRect(-20, 12, 12, 6);   // Bottom left wheel
    ctx.fillRect(8, -18, 12, 6);    // Top right wheel
    ctx.fillRect(8, 12, 12, 6);     // Bottom right wheel
    
    // Direction indicator line
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(40, 0);
    ctx.stroke();
    
    ctx.restore();
    
    // Draw speed indicator (motion trail effect)
    if (Math.abs(carState.speed) > 0.5) {
        ctx.save();
        ctx.globalAlpha = 0.3;
        ctx.translate(carState.x, carState.y);
        ctx.rotate((carState.angle * Math.PI) / 180);
        
        for (let i = 1; i <= 3; i++) {
            ctx.fillStyle = '#667eea';
            const offset = -i * 15;
            ctx.fillRect(offset - 20, -12, 40, 24);
        }
        
        ctx.restore();
    }
}

function drawInfo() {
    // Draw coordinate system reference
    ctx.fillStyle = '#64748b';
    ctx.font = '12px monospace';
    ctx.fillText('0° = Right →', 10, 20);
    ctx.fillText('90° = Down ↓', 10, 35);
    ctx.fillText('180° = Left ←', 10, 50);
    ctx.fillText('270° = Up ↑', 10, 65);
    
    // Draw current position
    ctx.fillText(`Position: (${Math.round(carState.x)}, ${Math.round(carState.y)})`, 10, canvas.height - 10);
}

// Clean up on page unload
window.addEventListener('beforeunload', function() {
    if (mqttClient) {
        mqttClient.end();
    }
    if (animationId) {
        cancelAnimationFrame(animationId);
    }
});
