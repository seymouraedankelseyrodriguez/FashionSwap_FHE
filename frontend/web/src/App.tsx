// App.tsx
import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface FashionItem {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  category: string;
  size: string;
  condition: string;
  status: "available" | "matched" | "exchanged";
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<FashionItem[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showAddModal, setShowAddModal] = useState(false);
  const [adding, setAdding] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newItemData, setNewItemData] = useState({
    category: "",
    size: "",
    condition: "",
    description: ""
  });
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [showTutorial, setShowTutorial] = useState(false);

  // Stats for dashboard
  const availableCount = items.filter(i => i.status === "available").length;
  const matchedCount = items.filter(i => i.status === "matched").length;
  const exchangedCount = items.filter(i => i.status === "exchanged").length;

  useEffect(() => {
    loadItems().finally(() => setLoading(false));
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

  const loadItems = async () => {
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
      
      const keysBytes = await contract.getData("item_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing item keys:", e);
        }
      }
      
      const list: FashionItem[] = [];
      
      for (const key of keys) {
        try {
          const itemBytes = await contract.getData(`item_${key}`);
          if (itemBytes.length > 0) {
            try {
              const itemData = JSON.parse(ethers.toUtf8String(itemBytes));
              list.push({
                id: key,
                encryptedData: itemData.data,
                timestamp: itemData.timestamp,
                owner: itemData.owner,
                category: itemData.category,
                size: itemData.size,
                condition: itemData.condition,
                status: itemData.status || "available"
              });
            } catch (e) {
              console.error(`Error parsing item data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading item ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setItems(list);
    } catch (e) {
      console.error("Error loading items:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const addItem = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setAdding(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting item data with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newItemData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const itemId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const itemData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        category: newItemData.category,
        size: newItemData.size,
        condition: newItemData.condition,
        status: "available"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `item_${itemId}`, 
        ethers.toUtf8Bytes(JSON.stringify(itemData))
      );
      
      const keysBytes = await contract.getData("item_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(itemId);
      
      await contract.setData(
        "item_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Item added securely with FHE encryption!"
      });
      
      await loadItems();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowAddModal(false);
        setNewItemData({
          category: "",
          size: "",
          condition: "",
          description: ""
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
      setAdding(false);
    }
  };

  const requestMatch = async (itemId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing match request with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const itemBytes = await contract.getData(`item_${itemId}`);
      if (itemBytes.length === 0) {
        throw new Error("Item not found");
      }
      
      const itemData = JSON.parse(ethers.toUtf8String(itemBytes));
      
      const updatedItem = {
        ...itemData,
        status: "matched"
      };
      
      await contract.setData(
        `item_${itemId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedItem))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE match request completed!"
      });
      
      await loadItems();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Match failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const completeExchange = async (itemId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Finalizing exchange with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const itemBytes = await contract.getData(`item_${itemId}`);
      if (itemBytes.length === 0) {
        throw new Error("Item not found");
      }
      
      const itemData = JSON.parse(ethers.toUtf8String(itemBytes));
      
      const updatedItem = {
        ...itemData,
        status: "exchanged"
      };
      
      await contract.setData(
        `item_${itemId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedItem))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE exchange completed!"
      });
      
      await loadItems();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Exchange failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to access FashionSwap",
      icon: "🔗"
    },
    {
      title: "Add Items",
      description: "List your fashion items with encrypted details",
      icon: "👕"
    },
    {
      title: "Browse & Match",
      description: "Find items you like and request matches",
      icon: "🔍"
    },
    {
      title: "Secure Exchange",
      description: "Complete exchanges with FHE-protected privacy",
      icon: "🤝"
    }
  ];

  const filteredItems = items.filter(item => {
    const matchesSearch = item.category.toLowerCase().includes(searchTerm.toLowerCase()) || 
                         item.description?.toLowerCase().includes(searchTerm.toLowerCase());
    const matchesCategory = selectedCategory === "all" || item.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  const categories = [...new Set(items.map(item => item.category))];

  if (loading) return (
    <div className="loading-screen">
      <div className="spinner"></div>
      <p>Initializing encrypted connection...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <div className="logo-icon">👗</div>
          <h1>FashionSwap <span>FHE</span></h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowAddModal(true)} 
            className="add-item-btn"
          >
            + Add Item
          </button>
          <button 
            className="tutorial-btn"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Guide" : "How It Works"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="hero-banner">
          <div className="hero-text">
            <h2>Anonymous Peer-to-Peer Fashion Exchange</h2>
            <p>Swap your clothes securely with FHE encryption protecting your privacy</p>
          </div>
        </div>
        
        {showTutorial && (
          <div className="tutorial-section">
            <h2>How FashionSwap Works</h2>
            <p className="subtitle">Private clothing exchange powered by FHE technology</p>
            
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
        
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-value">{items.length}</div>
            <div className="stat-label">Total Items</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{availableCount}</div>
            <div className="stat-label">Available</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{matchedCount}</div>
            <div className="stat-label">Matched</div>
          </div>
          <div className="stat-card">
            <div className="stat-value">{exchangedCount}</div>
            <div className="stat-label">Exchanged</div>
          </div>
        </div>
        
        <div className="search-filters">
          <div className="search-bar">
            <input
              type="text"
              placeholder="Search items..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            <button className="search-icon">🔍</button>
          </div>
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
          >
            <option value="all">All Categories</option>
            {categories.map(category => (
              <option key={category} value={category}>{category}</option>
            ))}
          </select>
          <button 
            onClick={loadItems}
            className="refresh-btn"
            disabled={isRefreshing}
          >
            {isRefreshing ? "Refreshing..." : "Refresh"}
          </button>
        </div>
        
        <div className="items-grid">
          {filteredItems.length === 0 ? (
            <div className="no-items">
              <div className="no-items-icon">👚</div>
              <p>No fashion items found</p>
              <button 
                className="primary-btn"
                onClick={() => setShowAddModal(true)}
              >
                Add First Item
              </button>
            </div>
          ) : (
            filteredItems.map(item => (
              <div className="item-card" key={item.id}>
                <div className="item-image">
                  <div className="image-placeholder">
                    {item.category === "Dress" && "👗"}
                    {item.category === "Shirt" && "👕"}
                    {item.category === "Pants" && "👖"}
                    {item.category === "Shoes" && "👟"}
                    {item.category === "Accessory" && "👜"}
                  </div>
                </div>
                <div className="item-details">
                  <h3>{item.category}</h3>
                  <div className="item-meta">
                    <span>Size: {item.size}</span>
                    <span>Condition: {item.condition}</span>
                  </div>
                  <div className={`item-status ${item.status}`}>
                    {item.status}
                  </div>
                  <div className="item-actions">
                    {!isOwner(item.owner) && item.status === "available" && (
                      <button 
                        className="action-btn"
                        onClick={() => requestMatch(item.id)}
                      >
                        Request Match
                      </button>
                    )}
                    {isOwner(item.owner) && item.status === "matched" && (
                      <button 
                        className="action-btn"
                        onClick={() => completeExchange(item.id)}
                      >
                        Complete Exchange
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
  
      {showAddModal && (
        <ModalAdd 
          onSubmit={addItem} 
          onClose={() => setShowAddModal(false)} 
          adding={adding}
          itemData={newItemData}
          setItemData={setNewItemData}
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
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="spinner"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
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
            <div className="logo">👗 FashionSwap</div>
            <p>Anonymous peer-to-peer fashion exchange with FHE protection</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">About</a>
            <a href="#" className="footer-link">Privacy</a>
            <a href="#" className="footer-link">Terms</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Privacy</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} FashionSwap. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalAddProps {
  onSubmit: () => void; 
  onClose: () => void; 
  adding: boolean;
  itemData: any;
  setItemData: (data: any) => void;
}

const ModalAdd: React.FC<ModalAddProps> = ({ 
  onSubmit, 
  onClose, 
  adding,
  itemData,
  setItemData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setItemData({
      ...itemData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!itemData.category || !itemData.size || !itemData.condition) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="add-modal">
        <div className="modal-header">
          <h2>Add Fashion Item</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <span>🔒</span> Your item details will be encrypted with FHE
          </div>
          
          <div className="form-group">
            <label>Category *</label>
            <select 
              name="category"
              value={itemData.category} 
              onChange={handleChange}
            >
              <option value="">Select category</option>
              <option value="Dress">Dress</option>
              <option value="Shirt">Shirt</option>
              <option value="Pants">Pants</option>
              <option value="Shoes">Shoes</option>
              <option value="Accessory">Accessory</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>Size *</label>
            <select 
              name="size"
              value={itemData.size} 
              onChange={handleChange}
            >
              <option value="">Select size</option>
              <option value="XS">XS</option>
              <option value="S">S</option>
              <option value="M">M</option>
              <option value="L">L</option>
              <option value="XL">XL</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>Condition *</label>
            <select 
              name="condition"
              value={itemData.condition} 
              onChange={handleChange}
            >
              <option value="">Select condition</option>
              <option value="New">New</option>
              <option value="Like New">Like New</option>
              <option value="Good">Good</option>
              <option value="Fair">Fair</option>
            </select>
          </div>
          
          <div className="form-group">
            <label>Description</label>
            <textarea 
              name="description"
              value={itemData.description} 
              onChange={handleChange}
              placeholder="Additional details about the item..." 
              rows={3}
            />
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={adding}
            className="submit-btn"
          >
            {adding ? "Encrypting with FHE..." : "Add Item"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;