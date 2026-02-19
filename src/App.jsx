import { useState } from "react";
const COMPANY_NAME = import.meta.env.VITE_COMPANY_NAME;
import "./App.css";
import MonthlyIncomeCalculator from "./features/income/MonthlyIncomeCalculator.jsx";
import VariableManager from "./features/VariableManager.jsx";
import { initializeApp } from 'firebase/app';
import { getFirestore } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID,
};

const app = initializeApp(firebaseConfig);
window.db = getFirestore(app);
window.auth = getAuth(app);

const PAGES = {
  HOME: "HOME",
  INCOME_CALC: "INCOME_CALC",
  VARIABLE_MANAGER: "VARIABLE_MANAGER",
};

function App() {
  const [activePage, setActivePage] = useState(PAGES.HOME);

  const renderPage = () => {
    switch (activePage) {
      case PAGES.INCOME_CALC:
        return <MonthlyIncomeCalculator onBack={() => setActivePage(PAGES.HOME)} />;
      case PAGES.VARIABLE_MANAGER:
        return <VariableManager onBack={() => setActivePage(PAGES.HOME)} />;
      case PAGES.HOME:
      default:
        return (
          <div className="menu">
            <h1>{COMPANY_NAME} Admin</h1>
            <p className="subtitle">Management tools for {COMPANY_NAME}</p>
            <div className="menu-buttons">
              <button onClick={() => setActivePage(PAGES.INCOME_CALC)}>
                Simple Monthly Income Calculator
              </button>

              <button onClick={() => setActivePage(PAGES.VARIABLE_MANAGER)}>
                Variable Manager
              </button>
              <button disabled>Project Hours Log (coming soon)</button>
              <button disabled>Tax Summary (coming soon)</button>
            </div>
          </div>
        );
    }
  };

  return <div className="app-shell">{renderPage()}</div>;
}

export default App;
