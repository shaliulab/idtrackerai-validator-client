function Tab({ id, activeTab, setActiveTab, children }) {
  return (
    <button className={activeTab === id ? "active" : ""} onClick={() => setActiveTab(id)}>
      {children}
    </button>
  );
}

export default Tab;