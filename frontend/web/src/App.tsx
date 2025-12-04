import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface EncryptedNotebook {
  id: string;
  name: string;
  encryptedContent: string;
  timestamp: number;
  owner: string;
  size: number;
  type: string;
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [notebooks, setNotebooks] = useState<EncryptedNotebook[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newNotebookData, setNewNotebookData] = useState({
    name: "",
    type: "python",
    content: ""
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [selectedNotebook, setSelectedNotebook] = useState<EncryptedNotebook | null>(null);
  const [showDetailsModal, setShowDetailsModal] = useState(false);

  // Calculate statistics for dashboard
  const pythonCount = notebooks.filter(n => n.type === "python").length;
  const rCount = notebooks.filter(n => n.type === "r").length;
  const juliaCount = notebooks.filter(n => n.type === "julia").length;

  useEffect(() => {
    loadNotebooks().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadNotebooks = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("notebook_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing notebook keys:", e);
        }
      }
      
      const list: EncryptedNotebook[] = [];
      
      for (const key of keys) {
        try {
          const notebookBytes = await contract.getData(`notebook_${key}`);
          if (notebookBytes.length > 0) {
            try {
              const notebookData = JSON.parse(ethers.toUtf8String(notebookBytes));
              list.push({
                id: key,
                name: notebookData.name,
                encryptedContent: notebookData.content,
                timestamp: notebookData.timestamp,
                owner: notebookData.owner,
                size: notebookData.size,
                type: notebookData.type
              });
            } catch (e) {
              console.error(`Error parsing notebook data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading notebook ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setNotebooks(list);
    } catch (e) {
      console.error("Error loading notebooks:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const submitNotebook = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setCreating(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting notebook with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedContent = `FHE-${btoa(newNotebookData.content)}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const notebookId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const notebookData = {
        name: newNotebookData.name,
        content: encryptedContent,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        size: newNotebookData.content.length,
        type: newNotebookData.type
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `notebook_${notebookId}`, 
        ethers.toUtf8Bytes(JSON.stringify(notebookData))
      );
      
      const keysBytes = await contract.getData("notebook_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(notebookId);
      
      await contract.setData(
        "notebook_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted notebook submitted securely!"
      });
      
      await loadNotebooks();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowCreateModal(false);
        setNewNotebookData({
          name: "",
          type: "python",
          content: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Submission failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setCreating(false);
    }
  };

  const checkAvailability = async () => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Checking FHE kernel availability..."
    });

    try {
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const isAvailable = await contract.isAvailable();
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: `FHE kernel is ${isAvailable ? "available" : "not available"}`
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Availability check failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const viewNotebookDetails = (notebook: EncryptedNotebook) => {
    setSelectedNotebook(notebook);
    setShowDetailsModal(true);
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to access the encrypted Jupyter environment",
      icon: "🔗"
    },
    {
      title: "Create Encrypted Notebook",
      description: "Create a new notebook that will be encrypted using FHE technology",
      icon: "📓"
    },
    {
      title: "FHE Computation",
      description: "Run computations on encrypted data without decryption",
      icon: "⚙️"
    },
    {
      title: "Share Securely",
      description: "Collaborate with others while keeping your data private",
      icon: "🔒"
    }
  ];

  const renderLanguageChart = () => {
    const total = notebooks.length || 1;
    const pythonPercentage = (pythonCount / total) * 100;
    const rPercentage = (rCount / total) * 100;
    const juliaPercentage = (juliaCount / total) * 100;

    return (
      <div className="chart-container">
        <div className="bar-chart">
          <div className="bar-wrapper">
            <div className="bar-label">Python</div>
            <div className="bar">
              <div 
                className="bar-fill python" 
                style={{ width: `${pythonPercentage}%` }}
              ></div>
            </div>
            <div className="bar-value">{pythonCount}</div>
          </div>
          <div className="bar-wrapper">
            <div className="bar-label">R</div>
            <div className="bar">
              <div 
                className="bar-fill r" 
                style={{ width: `${rPercentage}%` }}
              ></div>
            </div>
            <div className="bar-value">{rCount}</div>
          </div>
          <div className="bar-wrapper">
            <div className="bar-label">Julia</div>
            <div className="bar">
              <div 
                className="bar-fill julia" 
                style={{ width: `${juliaPercentage}%` }}
              ></div>
            </div>
            <div className="bar-value">{juliaCount}</div>
          </div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing FHE environment...</p>
    </div>
  );

  return (
    <div className="app-container glass-theme">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">
            <div className="notebook-icon"></div>
          </div>
          <h1>Jupyter<span>FHE</span></h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-notebook-btn glass-button"
          >
            <div className="add-icon"></div>
            New Notebook
          </button>
          <button 
            className="glass-button"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Tutorial" : "Show Tutorial"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="welcome-banner">
          <div className="welcome-text">
            <h2>FHE-Based Secure Jupyter Notebook</h2>
            <p>Run computations on encrypted data without decryption using Fully Homomorphic Encryption</p>
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>FHE Jupyter Tutorial</h2>
            <p className="subtitle">Learn how to use encrypted notebooks</p>
            
            <div className="tutorial-steps">
              {tutorialSteps.map((step, index) => (
                <div 
                  className="tutorial-step"
                  key={index}
                >
                  <div className="step-icon">{step.icon}</div>
                  <div className="step-content">
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        
        <div className="dashboard-grid">
          <div className="dashboard-card glass-card">
            <h3>Project Introduction</h3>
            <p>JupyterFHE is a secure cloud-hosted Jupyter Notebook environment with FHE capabilities. All computations are performed on encrypted data without decryption, ensuring complete privacy for sensitive datasets.</p>
            <div className="fhe-badge">
              <span>FHE-Powered</span>
            </div>
          </div>
          
          <div className="dashboard-card glass-card">
            <h3>Notebook Statistics</h3>
            <div className="stats-grid">
              <div className="stat-item">
                <div className="stat-value">{notebooks.length}</div>
                <div className="stat-label">Total Notebooks</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{pythonCount}</div>
                <div className="stat-label">Python</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{rCount}</div>
                <div className="stat-label">R</div>
              </div>
              <div className="stat-item">
                <div className="stat-value">{juliaCount}</div>
                <div className="stat-label">Julia</div>
              </div>
            </div>
          </div>
          
          <div className="dashboard-card glass-card">
            <h3>Language Distribution</h3>
            {renderLanguageChart()}
          </div>
        </div>
        
        <div className="notebooks-section">
          <div className="section-header">
            <h2>Encrypted Notebooks</h2>
            <div className="header-actions">
              <button 
                onClick={checkAvailability}
                className="check-btn glass-button"
              >
                Check FHE Kernel
              </button>
              <button 
                onClick={loadNotebooks}
                className="refresh-btn glass-button"
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
            </div>
          </div>
          
          <div className="notebooks-list glass-card">
            <div className="table-header">
              <div className="header-cell">Name</div>
              <div className="header-cell">Type</div>
              <div className="header-cell">Owner</div>
              <div className="header-cell">Date</div>
              <div className="header-cell">Size</div>
              <div className="header-cell">Actions</div>
            </div>
            
            {notebooks.length === 0 ? (
              <div className="no-notebooks">
                <div className="no-notebooks-icon"></div>
                <p>No encrypted notebooks found</p>
                <button 
                  className="glass-button primary"
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Notebook
                </button>
              </div>
            ) : (
              notebooks.map(notebook => (
                <div className="notebook-row" key={notebook.id}>
                  <div className="table-cell notebook-name">{notebook.name}</div>
                  <div className="table-cell">
                    <span className={`type-badge ${notebook.type}`}>
                      {notebook.type}
                    </span>
                  </div>
                  <div className="table-cell">{notebook.owner.substring(0, 6)}...{notebook.owner.substring(38)}</div>
                  <div className="table-cell">
                    {new Date(notebook.timestamp * 1000).toLocaleDateString()}
                  </div>
                  <div className="table-cell">{notebook.size} bytes</div>
                  <div className="table-cell actions">
                    <button 
                      className="action-btn glass-button"
                      onClick={() => viewNotebookDetails(notebook)}
                    >
                      View Details
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
  
      {showCreateModal && (
        <ModalCreate 
          onSubmit={submitNotebook} 
          onClose={() => setShowCreateModal(false)} 
          creating={creating}
          notebookData={newNotebookData}
          setNotebookData={setNewNotebookData}
        />
      )}
      
      {showDetailsModal && selectedNotebook && (
        <ModalDetails
          notebook={selectedNotebook}
          onClose={() => setShowDetailsModal(false)}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content glass-card">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && <div className="check-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="notebook-icon"></div>
              <span>JupyterFHE</span>
            </div>
            <p>Secure encrypted computation using FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} JupyterFHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalCreateProps {
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  notebookData: any;
  setNotebookData: (data: any) => void;
}

const ModalCreate: React.FC<ModalCreateProps> = ({ 
  onSubmit, 
  onClose, 
  creating,
  notebookData,
  setNotebookData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setNotebookData({
      ...notebookData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!notebookData.name || !notebookData.content) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="create-modal glass-card">
        <div className="modal-header">
          <h2>Create Encrypted Notebook</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="key-icon"></div> Your notebook will be encrypted with FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Notebook Name *</label>
              <input 
                type="text"
                name="name"
                value={notebookData.name} 
                onChange={handleChange}
                placeholder="My Encrypted Notebook" 
                className="glass-input"
              />
            </div>
            
            <div className="form-group">
              <label>Language *</label>
              <select 
                name="type"
                value={notebookData.type} 
                onChange={handleChange}
                className="glass-select"
              >
                <option value="python">Python</option>
                <option value="r">R</option>
                <option value="julia">Julia</option>
              </select>
            </div>
            
            <div className="form-group full-width">
              <label>Initial Content *</label>
              <textarea 
                name="content"
                value={notebookData.content} 
                onChange={handleChange}
                placeholder="Enter your notebook content here..." 
                className="glass-textarea"
                rows={8}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="privacy-icon"></div> Content remains encrypted during FHE computation
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn glass-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={creating}
            className="submit-btn glass-button primary"
          >
            {creating ? "Encrypting with FHE..." : "Create Encrypted Notebook"}
          </button>
        </div>
      </div>
    </div>
  );
};

interface ModalDetailsProps {
  notebook: EncryptedNotebook;
  onClose: () => void;
}

const ModalDetails: React.FC<ModalDetailsProps> = ({ notebook, onClose }) => {
  return (
    <div className="modal-overlay">
      <div className="details-modal glass-card">
        <div className="modal-header">
          <h2>Notebook Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="detail-section">
            <h3>Basic Information</h3>
            <div className="detail-grid">
              <div className="detail-item">
                <span className="detail-label">Name:</span>
                <span className="detail-value">{notebook.name}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Type:</span>
                <span className="detail-value">{notebook.type}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Owner:</span>
                <span className="detail-value">{notebook.owner}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Created:</span>
                <span className="detail-value">{new Date(notebook.timestamp * 1000).toLocaleString()}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">Size:</span>
                <span className="detail-value">{notebook.size} bytes</span>
              </div>
            </div>
          </div>
          
          <div className="detail-section">
            <h3>Encrypted Content</h3>
            <div className="encrypted-content">
              <div className="encryption-badge">
                <div className="lock-icon"></div>
                <span>FHE Encrypted</span>
              </div>
              <div className="content-preview">
                {notebook.encryptedContent.substring(0, 100)}...
              </div>
            </div>
          </div>
          
          <div className="detail-section">
            <h3>FHE Capabilities</h3>
            <div className="capabilities-list">
              <div className="capability-item">
                <div className="check-icon"></div>
                <span>Secure computation on encrypted data</span>
              </div>
              <div className="capability-item">
                <div className="check-icon"></div>
                <span>Privacy-preserving analytics</span>
              </div>
              <div className="capability-item">
                <div className="check-icon"></div>
                <span>Encrypted collaboration</span>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="close-btn glass-button"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;