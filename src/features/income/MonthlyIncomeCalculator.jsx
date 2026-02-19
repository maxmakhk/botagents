import { useState } from "react";
import "./monthlyIncome.css";

//（20% tax + 8% NI）
const TAX_RATE = 0.2;
const NI_RATE = 0.08;

function formatMoney(value) {
  if (Number.isNaN(value)) return "0.00";
  return value.toFixed(2);
}

export default function MonthlyIncomeCalculator({ onBack }) {
  const [gross, setGross] = useState("");
  const [result, setResult] = useState(null);

  // hourly / daily helpers
  const [hourlyRate, setHourlyRate] = useState("");
  const [monthlyHours, setMonthlyHours] = useState("");
  const [dailyRate, setDailyRate] = useState("");
  const [monthlyDays, setMonthlyDays] = useState("");

  const handleCalculate = () => {
    const g = parseFloat(gross);
    if (Number.isNaN(g) || g < 0) {
      alert("Please enter a valid monthly gross income.");
      return;
    }

    const tax = g * TAX_RATE;
    const ni = g * NI_RATE;
    const net = g - tax - ni;

    setResult({
      gross: g,
      tax,
      ni,
      net,
    });
  };

  // hourly → monthly
  const handleFromHourly = () => {
    const h = parseFloat(hourlyRate);
    const hrs = parseFloat(monthlyHours);
    if (Number.isNaN(h) || Number.isNaN(hrs) || h < 0 || hrs < 0) {
      alert("Please enter valid hourly rate and monthly hours.");
      return;
    }
    const monthlyGross = h * hrs;
    setGross(String(monthlyGross.toFixed(2)));
    // setTimeout(handleCalculate, 0);
  };

  // daily → monthly
  const handleFromDaily = () => {
    const d = parseFloat(dailyRate);
    const days = parseFloat(monthlyDays);
    if (Number.isNaN(d) || Number.isNaN(days) || d < 0 || days < 0) {
      alert("Please enter valid daily rate and monthly days.");
      return;
    }
    const monthlyGross = d * days;
    setGross(String(monthlyGross.toFixed(2)));
    // optional: setTimeout(handleCalculate, 0);
  };

  return (
    <div className="income-page">
      <button className="back-btn" onClick={onBack}>
        ← Back to menu
      </button>

      <h2>Simple Monthly Income Calculator</h2>
      <p className="page-subtitle">
        Rough estimate using flat 20% income tax and 8% NI (for demo only).
      </p>

      {/* cal */}
      <section className="helpers">
        <h3>Monthly income helpers</h3>

        {/* 1. hour */}
        <div className="helper-block">
          <h4>From hourly rate</h4>
          <div className="helper-row">
            <label>Hourly rate (£)</label>
            <input
              type="number"
              min="0"
              step="1"
              value={hourlyRate}
              onChange={(e) => setHourlyRate(e.target.value)}
            />
          </div>
          <div className="helper-row">
            <label>Hours per month</label>
            <input
              type="number"
              min="0"
              step="1"
              value={monthlyHours}
              onChange={(e) => setMonthlyHours(e.target.value)}
            />
          </div>
          <button className="helper-btn" onClick={handleFromHourly}>
            Use as monthly gross
          </button>
        </div>

        {/* 2. daily */}
        <div className="helper-block">
          <h4>From daily rate</h4>
          <div className="helper-row">
            <label>Daily rate (£)</label>
            <input
              type="number"
              min="0"
              step="1"
              value={dailyRate}
              onChange={(e) => setDailyRate(e.target.value)}
            />
          </div>
          <div className="helper-row">
            <label>Days per month</label>
            <input
              type="number"
              min="0"
              step="1"
              value={monthlyDays}
              onChange={(e) => setMonthlyDays(e.target.value)}
            />
          </div>
          <button className="helper-btn" onClick={handleFromDaily}>
            Use as monthly gross
          </button>
        </div>
      </section>

      {/* month */}
      <div className="income-input-row">
        <label htmlFor="grossIncome">Monthly gross income (£)</label>
        <div className="input-group">
          <input
            id="grossIncome"
            type="number"
            min="0"
            step="100"
            placeholder="e.g. 4330"
            value={gross}
            onChange={(e) => setGross(e.target.value)}
            onKeyUp={(e) => {
              if (e.key === "Enter") handleCalculate();
            }}
          />
          <button onClick={handleCalculate}>Calculate</button>
        </div>
      </div>

      {result && (
        <table className="result-table">
          <thead>
            <tr>
              <th>Item</th>
              <th>Amount (£)</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Gross income</td>
              <td>{formatMoney(result.gross)}</td>
            </tr>
            <tr>
              <td>Estimated income tax (20%)</td>
              <td>{formatMoney(result.tax)}</td>
            </tr>
            <tr>
              <td>Estimated NI (8%)</td>
              <td>{formatMoney(result.ni)}</td>
            </tr>
            <tr>
              <td><strong>Estimated take‑home</strong></td>
              <td>{formatMoney(result.net)}</td>
            </tr>
          </tbody>
        </table>
      )}

      <p className="note">
        This tool is a simplification. Real UK tax uses bands, personal allowance and
        different NI thresholds.[web:2][web:25]
      </p>
    </div>
  );
}
