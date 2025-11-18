# ESP32 Motor Control Dashboard Setup Guide

This guide will walk you through setting up a complete motor control system with ESP32, HiveMQ MQTT broker, and a web dashboard.

## 🆕 NEW: PID Control Mode Comparison Feature

**Generate graphs like your professor's example!** Compare P-only, PI-only, and full PID control responses.

### Quick Links:
- 📘 [Quick Reference Guide](QUICK-REFERENCE.md) - Fast 5-step setup
- 📖 [Detailed PID Comparison Guide](PID-COMPARISON-GUIDE.md) - Complete instructions
- 📝 [Changes Summary](CHANGES-SUMMARY.md) - What was modified

### What You Can Do Now:
- ✅ Switch between P, PI, and PID control modes with one click
- ✅ Generate overlaid comparison graphs showing all three responses
- ✅ See setpoint line (like the 21°C baseline in professor's temperature example)
- ✅ Export graphs as PNG for reports or CSV for analysis
- ✅ Color-coded traces: 🔴 Red (P-only), 🟠 Orange (PI-only), 🟣 Purple (Full PID)

**Files to use:**
- Arduino: `esp32_motor_control_pid_modes.ino` (new file with mode support)
- Website: `index.html` and `script.js` (already updated)

---

## 📋 Table of Contents
1. [Prerequisites](#prerequisites)
2. [HiveMQ Cloud Setup](#hivemq-cloud-setup)
3. [ESP32 Code Configuration](#esp32-code-configuration)
4. [Web Dashboard Setup](#web-dashboard-setup)
5. [Testing the System](#testing-the-system)
6. [Troubleshooting](#troubleshooting)

## 🔧 Prerequisites

### Hardware Required:
- ESP32 Development Board
- DC Motor with Encoder (600 PPR)
- L298N Motor Driver
- Jumper wires
- Breadboard (optional)
- Power supply for motor (6-12V)

### Software Required:
- Arduino IDE with ESP32 support
- Modern web browser (Chrome, Firefox, Edge)
- WiFi network access

### Arduino Libraries Required:
```cpp
// Install these libraries through Arduino IDE Library Manager:
- WiFi (built-in with ESP32)
- PubSubClient by Nick O'Leary
- ArduinoJson by Benoit Blanchon (version 6.x)
```

## ☁️ HiveMQ Cloud Setup

### Step 1: Create HiveMQ Cloud Account
1. Go to [HiveMQ Cloud](https://console.hivemq.cloud/)
2. Sign up for a free account
3. Verify your email address
4. Log in to your dashboard

### Step 2: Create a New Cluster
1. Click **"Create Cluster"**
2. Choose **"Serverless"** (free tier)
3. Select your preferred region (choose closest to your location)
4. Give your cluster a name (e.g., "motor-control-cluster")
5. Click **"Create Cluster"**
6. Wait for cluster to be provisioned (takes 2-3 minutes)

### Step 3: Configure Access Management
1. Once cluster is ready, click **"Manage Cluster"**
2. Go to **"Access Management"** tab
3. Click **"Add Credentials"**
4. Create credentials:
   - **Username**: `motor-controller` (or your choice)
   - **Password**: Generate a strong password
   - **Permissions**: Select "Publish and Subscribe"
5. **Important**: Save these credentials securely - you'll need them later!

### Step 4: Get Connection Details
1. Go to **"Overview"** tab
2. Note down your cluster details:
   - **Host**: Something like `abc123def.s1.eu.hivemq.cloud`
   - **Port**: 8883 (TLS) or 8884 (WebSocket Secure)
   - **Username**: Your created username
   - **Password**: Your created password

## 🔌 ESP32 Code Configuration

### Step 1: Install Required Libraries
Open Arduino IDE and install these libraries:

1. **PubSubClient**:
   - Go to Tools → Manage Libraries
   - Search "PubSubClient"
   - Install by Nick O'Leary

2. **ArduinoJson**:
   - Search "ArduinoJson"
   - Install version 6.x by Benoit Blanchon

### Step 2: Configure ESP32 Code
Open `esp32_motor_control_mqtt.ino` and update these sections:

```cpp
// ------------ WiFi Configuration ------------
const char* ssid = "YOUR_WIFI_SSID";          // Replace with your WiFi name
const char* password = "YOUR_WIFI_PASSWORD";   // Replace with your WiFi password

// ------------ MQTT Configuration ------------
const char* mqtt_server = "your-cluster.s1.eu.hivemq.cloud";  // Your HiveMQ cluster host
const int mqtt_port = 8883;  // TLS port
const char* mqtt_username = "motor-controller";   // Your HiveMQ username
const char* mqtt_password = "your-password";      // Your HiveMQ password
```

### Step 3: Hardware Connections
Connect your hardware as follows:

| ESP32 Pin | Component | Wire Color (if applicable) |
|-----------|-----------|---------------------------|
| GPIO 13   | Encoder A | Green |
| GPIO 14   | Encoder B | White |
| GPIO 19   | L298N ENA | - |
| GPIO 26   | L298N IN1 | - |
| GPIO 25   | L298N IN2 | - |
| GND       | Common Ground | Black |
| VIN/5V    | L298N VCC (logic) | Red |

**L298N Motor Driver Connections:**
- Connect motor to OUT1 and OUT2
- Connect motor power supply (6-12V) to motor power input
- Connect logic power (5V) from ESP32

### Step 4: Upload Code
1. Connect ESP32 to your computer
2. Select correct board and port in Arduino IDE
3. Upload the code
4. Open Serial Monitor (115200 baud) to see connection status

## 🌐 Web Dashboard Setup

### Step 1: Configure Dashboard
Open `script.js` and update the MQTT configuration:

```javascript
const MQTT_CONFIG = {
    host: 'your-cluster.s1.eu.hivemq.cloud',  // Your HiveMQ cluster URL
    port: 8884,  // WebSocket Secure port
    username: 'motor-controller',  // Your HiveMQ username
    password: 'your-password',     // Your HiveMQ password
    clientId: 'motor-dashboard-' + Math.random().toString(16).substr(2, 8)
};
```

### Step 2: Test the Dashboard
1. Open `index.html` in a modern web browser
2. The dashboard should show "Connected" status if configured correctly
3. If you see "Disconnected", check your MQTT configuration

### Step 3: Test Motor Control
1. Enter a target RPM value (-350 to 350)
2. Click "Set RPM" or press Enter
3. The ESP32 should receive the command and start controlling the motor
4. You should see real-time data updates on the dashboard

## 🧪 Testing the System

### Step 1: Basic Connectivity Test
1. Power up your ESP32
2. Check Serial Monitor for WiFi and MQTT connection messages
3. Open the web dashboard - it should show "Connected"

### Step 2: Motor Control Test
1. Start with small RPM values (±10 to ±30)
2. Use the dashboard to send commands
3. Observe motor response and data feedback
4. Check that the charts update in real-time

### Step 3: PID Tuning (if needed)
If motor response is not satisfactory, adjust PID parameters in the ESP32 code:
```cpp
double Kp = 1.0;   // Proportional gain
double Ki = 5.0;   // Integral gain  
double Kd = 0.05;  // Derivative gain
```

## 🔍 Troubleshooting

### Common Issues and Solutions

#### ESP32 Won't Connect to WiFi
- Double-check SSID and password
- Ensure WiFi is 2.4GHz (ESP32 doesn't support 5GHz)
- Move ESP32 closer to router
- Check Serial Monitor for error messages

#### MQTT Connection Failed
- Verify HiveMQ cluster URL and credentials
- Check if cluster is active in HiveMQ console
- Ensure correct port (8883 for ESP32, 8884 for web dashboard)
- Check firewall settings

#### Web Dashboard Shows "Disconnected"
- Verify MQTT configuration in `script.js`
- Check browser console for error messages (F12 → Console)
- Ensure you're using WebSocket Secure port (8884)
- Try refreshing the page

#### Motor Not Responding
- Check hardware connections
- Verify motor power supply
- Test motor manually with simple code
- Check encoder wiring and connections
- Ensure L298N is properly powered

#### Erratic Motor Behavior
- Check encoder connections (A and B phases)
- Verify power supply stability
- Adjust PID parameters
- Check for mechanical binding

### Debug Tips

1. **Serial Monitor**: Always check ESP32 serial output for debug info
2. **Browser Console**: Use F12 to check for JavaScript errors
3. **HiveMQ Console**: Monitor message traffic in your cluster dashboard
4. **Network Tools**: Use browser network tab to check WebSocket connections

## 📊 System Architecture

```
[ESP32 + Motor] ←→ [WiFi Router] ←→ [Internet] ←→ [HiveMQ Cloud] ←→ [Web Dashboard]
```

**Data Flow:**
1. ESP32 reads encoder data and calculates actual RPM
2. PID controller adjusts PWM based on target vs actual RPM
3. Motor data is published to HiveMQ via MQTT
4. Web dashboard subscribes to motor data and displays real-time info
5. User commands from dashboard are sent to ESP32 via MQTT

## 🎯 Next Steps

Once your system is working:
1. Implement data logging
2. Add more advanced control features
3. Create mobile app interface
4. Add system health monitoring
5. Implement remote firmware updates

## 🆘 Support

If you encounter issues:
1. Check this troubleshooting guide
2. Review Serial Monitor output
3. Test components individually
4. Check HiveMQ cluster status
5. Verify all configuration parameters

Happy building! 🚀