// disabled: a string saying why (shown as the tooltip)
function Tab({ id, activeTab, setActiveTab, shortcut, disabled, children }) {
  return (
    <button className={`tab${activeTab === id ? ' active' : ''}`} onClick={() => setActiveTab(id)}
            disabled={!!disabled}
            title={disabled || (shortcut ? `Shortcut: ${shortcut}` : undefined)}>
      {children}
      {shortcut && <kbd>{shortcut}</kbd>}
    </button>
  );
}

export default Tab;
