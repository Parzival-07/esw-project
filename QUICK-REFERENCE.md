# PID Mode Comparison - Quick Reference

## 🎯 Goal
Generate graphs like professor's example showing P-only, PI-only, and full PID control responses.

---

## ⚡ Quick Setup (5 Steps)

### 1. Upload Arduino Code
```
File: esp32_motor_control_pid_modes.ino
Action: Upload to ESP32
```

### 2. Open Dashboard
```
File: index.html
Action: Open in browser
Check: MQTT shows "Connected"
```

### 3. Calibrate (First Time Only)
```
Click: "Start Calibration" button
Wait: 30 seconds for completion
```

### 4. Generate Graph
```
a) Click: "Clear All" on "PID Mode Comparison" chart
b) Set: Target RPM = 150
c) Click: "P-only" button → Wait 20 seconds
d) Click: "PI-only" button → Wait 20 seconds
e) Click: "Full PID" button → Wait 20 seconds
```

### 5. Export Results
```
Click: Download PNG (for report) or CSV (for analysis)
```

---

## 📊 Understanding the Graph

| Line Color | Control Mode | Expected Behavior |
|------------|--------------|-------------------|
| 🔵 Blue Dashed | **Setpoint** | Target RPM (constant horizontal line) |
| 🔴 Red | **P-only** | Fast rise, overshoot, doesn't reach target exactly |
| 🟠 Orange | **PI-only** | Reaches target, may oscillate before settling |
| 🟣 Purple | **Full PID** | Smooth approach, minimal overshoot, best performance |

---

## 🎮 Controls Location

### PID Control Mode Panel
- Located: Between "Calibration" and "Control Mode" sections
- Buttons: 
  - `P-only` (Red) - Sets Ki=0, Kd=0
  - `PI-only` (Orange) - Sets Kd=0
  - `Full PID` (Purple) - All gains active
- Active Mode: Shown in top-right of panel

### Comparison Chart
- Located: After "PWM vs Time" chart
- Controls:
  - `Clear All` - Reset chart for new test
  - `PNG` - Download as image
  - `CSV` - Download data for Excel/MATLAB

---

## 💡 Tips for Best Results

1. **Same Target**: Use the same RPM for all three tests (150 RPM recommended)
2. **Wait Time**: Give each mode 20-30 seconds to show full response
3. **Clear First**: Always click "Clear All" before starting new test
4. **Higher RPM**: 150-200 RPM shows clearer differences than low values
5. **Sequential**: Test P → PI → PID in order for best visual comparison

---

## 🔍 What Each Mode Does

### P-only (Proportional)
```
Kp = Active (e.g., 1.0)
Ki = 0  ← Forced to zero
Kd = 0  ← Forced to zero

Result: Fast response but steady-state error
```

### PI-only (Proportional + Integral)
```
Kp = Active (e.g., 1.0)
Ki = Active (e.g., 5.0)
Kd = 0  ← Forced to zero

Result: No steady-state error but may oscillate
```

### Full PID
```
Kp = Active (e.g., 1.0)
Ki = Active (e.g., 5.0)
Kd = Active (e.g., 0.05)

Result: Best overall performance, damped response
```

---

## 🐛 Troubleshooting

| Problem | Solution |
|---------|----------|
| Motor doesn't move | Click "Skip for now" or complete calibration |
| No line on graph | Make sure target RPM is set (not 0) |
| Lines look identical | Use higher RPM (150+) for clearer differences |
| Button says "Disconnected" | Check WiFi/MQTT credentials in Arduino code |
| Can't switch modes | Enable controls by completing/skipping calibration |

---

## 📱 Alternative: Serial Commands

If website doesn't work, use Serial Monitor:
```
150      ← Set target RPM
mode P   ← Switch to P-only
mode PI  ← Switch to PI-only
mode PID ← Switch to full PID
```

---

## 🎓 Matching Professor's Example

| Professor's Graph | Your Graph |
|-------------------|------------|
| Temperature (°C) | RPM (revolutions/min) |
| 21°C setpoint | 150 RPM setpoint |
| Time (minutes) | Time (seconds) |
| Red/Orange/Purple lines | Red/Orange/Purple lines |
| Horizontal baseline | Blue dashed setpoint |

**Same concept, different units!**

---

## 📋 Checklist for Report

- [ ] Upload new Arduino code to ESP32
- [ ] Complete system calibration
- [ ] Clear comparison chart
- [ ] Set target RPM to 150
- [ ] Test P-only mode (record 20 seconds)
- [ ] Test PI-only mode (record 20 seconds)
- [ ] Test Full PID mode (record 20 seconds)
- [ ] Download PNG graph
- [ ] Download CSV data
- [ ] Verify graph shows all three colored traces
- [ ] Verify blue setpoint line appears
- [ ] Include in report with explanation

---

## 📞 Need More Help?

See detailed guides:
- **CHANGES-SUMMARY.md** - What was changed and why
- **PID-COMPARISON-GUIDE.md** - Detailed step-by-step instructions

---

## ⚙️ Technical Summary

**Changes Required**: BOTH Arduino + Website

**Arduino**: Added mode switching (P/PI/PID), automatic gain zeroing, MQTT mode commands

**Website**: Added mode buttons, comparison chart with 4 datasets, auto-recording, CSV export

**Result**: Complete system matching professor's example!

---

*Last Updated: 2025*
