import React, { useState } from 'react';

function App() {
  const [name, setName] = useState('');

  const handleSubmit = () => {
    alert('Form submitted successfully');
  };

  return (
    <div className="app">
      <h1>Welcome to React App</h1>
      <p>Enter your details below to get started.</p>
      <input
        type="text"
        placeholder="Your full name"
        onChange={(e) => setName(e.target.value)}
      />
      <button title="Submit the form" onClick={handleSubmit}>
        Submit
      </button>
      <footer>
        <p>Copyright 2024. All rights reserved.</p>
      </footer>
    </div>
  );
}

export default App;