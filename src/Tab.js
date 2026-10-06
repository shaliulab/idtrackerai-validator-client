function Tab({ id, activeTab, setActiveTab, shortcut, children }) {
  return (
    <button className={`tab${activeTab === id ? ' active' : ''}`} onClick={() => setActiveTab(id)}
            title={shortcut ? `Shortcut: ${shortcut}` : undefined}>
      {children}
      {shortcut && <kbd>{shortcut}</kbd>}
    </button>
  );
}

export default Tab;
