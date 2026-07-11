import React, { useState, useEffect } from 'react';

const API_BASE = 'http://api.ecommerce.local/api';

interface Product {
  _id: string;
  name: string;
  description: string;
  price: number;
  stock: number;
  category: string;
}

interface CartItem {
  product: Product;
  quantity: number;
}

interface OrderItem {
  productId: string;
  name: string;
  quantity: number;
  price: number;
}

interface Order {
  _id: string;
  userId: string;
  items: OrderItem[];
  totalAmount: number;
  status: 'PENDING' | 'PAID' | 'FAILED';
  createdAt: string;
}

export default function App() {
  // Navigation & Views
  const [view, setView] = useState<'catalog' | 'admin' | 'orders'>('catalog');

  // Auth State
  const [user, setUser] = useState<{ id: string; name: string; email: string } | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isRegistering, setIsRegistering] = useState<boolean>(false);
  const [authForm, setAuthForm] = useState({ email: '', password: '', name: '' });
  const [authError, setAuthError] = useState<string | null>(null);

  // Catalog & Search State
  const [products, setProducts] = useState<Product[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Admin Form State
  const [adminForm, setAdminForm] = useState({
    name: '',
    description: '',
    price: '',
    stock: '',
    category: ''
  });
  const [adminSuccess, setAdminSuccess] = useState<string | null>(null);

  // Cart State
  const [cart, setCart] = useState<CartItem[]>([]);
  const [isCartOpen, setIsCartOpen] = useState(false);

  // Orders State
  const [orders, setOrders] = useState<Order[]>([]);
  const [checkoutLoading, setCheckoutLoading] = useState(false);
  const [checkoutMessage, setCheckoutMessage] = useState<string | null>(null);

  // Load Auth Token from localStorage on startup
  useEffect(() => {
    const savedToken = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    if (savedToken && savedUser) {
      setToken(savedToken);
      setUser(JSON.parse(savedUser));
    }
    fetchProducts();
  }, []);

  // Fetch orders when user changes or navigates to orders view
  useEffect(() => {
    if (user && view === 'orders') {
      fetchOrders();
    }
  }, [user, view]);

  // Poll orders when viewing orders to see status transitions (PENDING -> PAID / FAILED)
  useEffect(() => {
    let interval: any;
    if (user && view === 'orders') {
      interval = setInterval(() => {
        fetchOrders();
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [user, view]);

  const fetchProducts = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/products`);
      const data = await res.json();
      setProducts(data);
    } catch (err) {
      console.error('Erro ao buscar produtos:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      if (!searchQuery.trim()) {
        await fetchProducts();
        return;
      }

      // Tentamos o Elasticsearch primeiro
      const res = await fetch(`${API_BASE}/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: {
            multi_match: {
              query: searchQuery,
              fields: ['name', 'description', 'category'],
              fuzziness: 'AUTO'
            }
          }
        })
      });

      if (res.ok) {
        const data = await res.json();
        const searchResults = data.hits?.hits?.map((hit: any) => ({
          _id: hit._id,
          name: hit._source.name,
          description: hit._source.description,
          price: hit._source.price,
          category: hit._source.category,
          stock: hit._source.stock
        })) || [];
        setProducts(searchResults);
      } else {
        throw new Error('Falha na requisição para o Elasticsearch');
      }
    } catch (err) {
      console.warn('Elasticsearch indisponível. Usando fallback de busca de banco de dados...', err);
      // Fallback: Busca via Banco de Dados
      try {
        const res = await fetch(`${API_BASE}/products`);
        const allProducts = await res.json();
        const filtered = allProducts.filter((p: Product) =>
          p.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
          p.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
          p.category.toLowerCase().includes(searchQuery.toLowerCase())
        );
        setProducts(filtered);
      } catch (dbErr) {
        console.error('Erro no fallback:', dbErr);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleAuthSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    const endpoint = isRegistering ? '/auth/register' : '/auth/login';
    const payload = isRegistering
      ? { name: authForm.name, email: authForm.email, password: authForm.password }
      : { email: authForm.email, password: authForm.password };

    try {
      const res = await fetch(`${API_BASE}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Erro na autenticação');
      }

      if (isRegistering) {
        setIsRegistering(false);
        setAuthError('Registro concluído! Faça o login.');
      } else {
        setToken(data.accessToken);
        setUser(data.user);
        localStorage.setItem('token', data.accessToken);
        localStorage.setItem('user', JSON.stringify(data.user));
        setAuthForm({ email: '', password: '', name: '' });
      }
    } catch (err: any) {
      setAuthError(err.message);
    }
  };

  const handleLogout = () => {
    setToken(null);
    setUser(null);
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setView('catalog');
    setCart([]);
  };

  const handleCreateProduct = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminSuccess(null);
    try {
      const res = await fetch(`${API_BASE}/products`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          name: adminForm.name,
          description: adminForm.description,
          price: parseFloat(adminForm.price),
          stock: parseInt(adminForm.stock),
          category: adminForm.category
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao cadastrar produto');

      setAdminSuccess('Produto cadastrado com sucesso! Sincronizando para busca...');
      setAdminForm({ name: '', description: '', price: '', stock: '', category: '' });
      fetchProducts();
    } catch (err: any) {
      setAdminSuccess(`Erro: ${err.message}`);
    }
  };

  const addToCart = (product: Product) => {
    const existing = cart.find(item => item.product._id === product._id);
    if (existing) {
      setCart(cart.map(item =>
        item.product._id === product._id
          ? { ...item, quantity: item.quantity + 1 }
          : item
      ));
    } else {
      setCart([...cart, { product, quantity: 1 }]);
    }
    setIsCartOpen(true);
  };

  const updateCartQty = (productId: string, amount: number) => {
    setCart(cart.map(item => {
      if (item.product._id === productId) {
        const newQty = item.quantity + amount;
        return newQty > 0 ? { ...item, quantity: newQty } : null;
      }
      return item;
    }).filter(Boolean) as CartItem[]);
  };

  const fetchOrders = async () => {
    if (!user) return;
    try {
      const res = await fetch(`${API_BASE}/orders?userId=${user.id}`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {}
      });
      const data = await res.json();
      setOrders(data);
    } catch (err) {
      console.error('Erro ao buscar pedidos:', err);
    }
  };

  const handleCheckout = async () => {
    if (!user) {
      setAuthError('Você precisa fazer login para finalizar o pedido');
      setView('catalog');
      return;
    }
    setCheckoutLoading(true);
    setCheckoutMessage(null);

    const items = cart.map(item => ({
      productId: item.product._id,
      name: item.product.name,
      quantity: item.quantity,
      price: item.product.price
    }));

    try {
      const res = await fetch(`${API_BASE}/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ userId: user.id, items })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Erro ao processar checkout');

      setCheckoutMessage('Pedido criado! Processando pagamento...');
      setCart([]);
      setIsCartOpen(false);
      setView('orders');
      fetchOrders();
    } catch (err: any) {
      setCheckoutMessage(`Erro no checkout: ${err.message}`);
    } finally {
      setCheckoutLoading(false);
    }
  };

  const cartTotal = cart.reduce((sum, item) => sum + (item.product.price * item.quantity), 0);
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <div className="app-container">
      {/* HEADER */}
      <header className="header">
        <div className="logo" onClick={() => setView('catalog')} style={{ cursor: 'pointer' }}>
          <span>🌌</span> E-Commerce Pro
        </div>

        <nav className="nav-links">
          <button className={`nav-btn ${view === 'catalog' ? 'active' : ''}`} onClick={() => setView('catalog')}>
            Catálogo
          </button>

          {user && (
            <>
              <button className={`nav-btn ${view === 'orders' ? 'active' : ''}`} onClick={() => setView('orders')}>
                Meus Pedidos
              </button>
              <button className={`nav-btn ${view === 'admin' ? 'active' : ''}`} onClick={() => setView('admin')}>
                Painel Admin
              </button>
            </>
          )}

          {user ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Olá, {user.name}</span>
              <button className="btn btn-secondary" style={{ padding: '0.4rem 0.8rem' }} onClick={handleLogout}>
                Sair
              </button>
            </div>
          ) : (
            <button className="btn btn-primary" style={{ padding: '0.5rem 1.2rem' }} onClick={() => setIsRegistering(false)}>
              Entrar
            </button>
          )}

          <button className="cart-icon-btn" onClick={() => setIsCartOpen(true)}>
            🛒
            {cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
          </button>
        </nav>
      </header>

      {/* MAIN LAYOUT */}
      <main className="main-content">
        {!user && !isRegistering && view === 'catalog' === false && (
          <div className="auth-grid">
            <div className="card auth-card">
              <h2 style={{ marginBottom: '1.5rem', fontWeight: 800 }}>Faça Login</h2>
              {authError && <div style={{ color: 'var(--accent-danger)', marginBottom: '1rem', fontSize: '0.9rem' }}>{authError}</div>}
              <form onSubmit={handleAuthSubmit}>
                <div className="form-group">
                  <label className="form-label">E-mail</label>
                  <input
                    type="email"
                    className="form-control"
                    required
                    value={authForm.email}
                    onChange={e => setAuthForm({ ...authForm, email: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Senha</label>
                  <input
                    type="password"
                    className="form-control"
                    required
                    value={authForm.password}
                    onChange={e => setAuthForm({ ...authForm, password: e.target.value })}
                  />
                </div>
                <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }}>
                  Acessar Conta
                </button>
              </form>
              <div style={{ marginTop: '1.5rem', textAlign: 'center', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                Não tem uma conta? <span style={{ color: 'var(--accent-primary)', cursor: 'pointer', fontWeight: 600 }} onClick={() => setIsRegistering(true)}>Cadastre-se</span>
              </div>
            </div>
          </div>
        )}

        {!user && isRegistering && (
          <div className="auth-grid">
            <div className="card auth-card">
              <h2 style={{ marginBottom: '1.5rem', fontWeight: 800 }}>Criar Conta</h2>
              {authError && <div style={{ color: 'var(--accent-danger)', marginBottom: '1rem', fontSize: '0.9rem' }}>{authError}</div>}
              <form onSubmit={handleAuthSubmit}>
                <div className="form-group">
                  <label className="form-label">Nome Completo</label>
                  <input
                    type="text"
                    className="form-control"
                    required
                    value={authForm.name}
                    onChange={e => setAuthForm({ ...authForm, name: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">E-mail</label>
                  <input
                    type="email"
                    className="form-control"
                    required
                    value={authForm.email}
                    onChange={e => setAuthForm({ ...authForm, email: e.target.value })}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Senha</label>
                  <input
                    type="password"
                    className="form-control"
                    required
                    value={authForm.password}
                    onChange={e => setAuthForm({ ...authForm, password: e.target.value })}
                  />
                </div>
                <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }}>
                  Registrar e Entrar
                </button>
              </form>
              <div style={{ marginTop: '1.5rem', textAlign: 'center', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                Já possui conta? <span style={{ color: 'var(--accent-primary)', cursor: 'pointer', fontWeight: 600 }} onClick={() => setIsRegistering(false)}>Faça Login</span>
              </div>
            </div>
          </div>
        )}

        {(user || view === 'catalog') && (
          <>
            {/* CATALOG VIEW */}
            {view === 'catalog' && (
              <div>
                <div className="catalog-header">
                  <h1 style={{ fontWeight: 800 }}>Nosso Catálogo</h1>
                  <form onSubmit={handleSearch} className="search-box">
                    <input
                      type="text"
                      className="form-control"
                      placeholder="Pesquise por produtos usando Elasticsearch..."
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                    />
                    <button type="submit" className="btn btn-primary">
                      Buscar
                    </button>
                  </form>
                </div>

                {isLoading ? (
                  <div className="spinner"></div>
                ) : (
                  <div className="product-grid">
                    {products.length === 0 ? (
                      <p style={{ gridColumn: '1/-1', textAlign: 'center', color: 'var(--text-secondary)' }}>
                        Nenhum produto cadastrado.
                      </p>
                    ) : (
                      products.map(product => (
                        <div key={product._id} className="card product-card">
                          <div className="product-info">
                            <span className="product-category">{product.category}</span>
                            <h3 className="product-title">{product.name}</h3>
                            <p className="product-desc">{product.description}</p>
                            <div className="product-footer">
                              <span className="product-price">R$ {product.price.toFixed(2)}</span>
                              <button
                                className="btn btn-secondary"
                                style={{ padding: '0.5rem 1rem', fontSize: '0.9rem' }}
                                onClick={() => addToCart(product)}
                                disabled={product.stock <= 0}
                              >
                                {product.stock > 0 ? 'Adicionar 🛒' : 'Esgotado'}
                              </button>
                            </div>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.5rem' }}>
                              Estoque: {product.stock}
                            </span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ADMIN PANEL */}
            {view === 'admin' && user && (
              <div style={{ maxWidth: '600px', margin: '0 auto' }}>
                <div className="card">
                  <h1 style={{ fontWeight: 800, marginBottom: '1.5rem' }}>Cadastrar Novo Produto</h1>
                  {adminSuccess && (
                    <div style={{
                      padding: '0.75rem',
                      borderRadius: '8px',
                      backgroundColor: adminSuccess.includes('Erro') ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                      color: adminSuccess.includes('Erro') ? 'var(--accent-danger)' : 'var(--accent-success)',
                      marginBottom: '1.5rem'
                    }}>
                      {adminSuccess}
                    </div>
                  )}
                  <form onSubmit={handleCreateProduct}>
                    <div className="form-group">
                      <label className="form-label">Nome do Produto</label>
                      <input
                        type="text"
                        className="form-control"
                        required
                        value={adminForm.name}
                        onChange={e => setAdminForm({ ...adminForm, name: e.target.value })}
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Descrição</label>
                      <textarea
                        className="form-control"
                        rows={3}
                        required
                        value={adminForm.description}
                        onChange={e => setAdminForm({ ...adminForm, description: e.target.value })}
                      />
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                      <div className="form-group">
                        <label className="form-label">Preço (R$)</label>
                        <input
                          type="number"
                          step="0.01"
                          className="form-control"
                          required
                          value={adminForm.price}
                          onChange={e => setAdminForm({ ...adminForm, price: e.target.value })}
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label">Estoque Inicial</label>
                        <input
                          type="number"
                          className="form-control"
                          required
                          value={adminForm.stock}
                          onChange={e => setAdminForm({ ...adminForm, stock: e.target.value })}
                        />
                      </div>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Categoria</label>
                      <input
                        type="text"
                        className="form-control"
                        placeholder="Ex: Eletrônicos, Roupas, Livros"
                        required
                        value={adminForm.category}
                        onChange={e => setAdminForm({ ...adminForm, category: e.target.value })}
                      />
                    </div>
                    <button type="submit" className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }}>
                      Criar Produto & Indexar ⚡
                    </button>
                  </form>
                </div>
              </div>
            )}

            {/* ORDERS HISTORY VIEW */}
            {view === 'orders' && user && (
              <div className="card">
                <h1 style={{ fontWeight: 800, marginBottom: '1.5rem' }}>Histórico de Pedidos</h1>
                <p style={{ color: 'var(--text-secondary)', marginBottom: '1.5rem', fontSize: '0.9rem' }}>
                  Os pagamentos são processados em fila assíncrona. Esta página atualiza automaticamente a cada 3 segundos.
                </p>
                {orders.length === 0 ? (
                  <p style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '2rem' }}>
                    Você ainda não fez nenhum pedido.
                  </p>
                ) : (
                  <div style={{ overflowX: 'auto' }}>
                    <table className="orders-table">
                      <thead>
                        <tr>
                          <th>ID do Pedido</th>
                          <th>Data</th>
                          <th>Itens</th>
                          <th>Total</th>
                          <th>Status do Pagamento</th>
                        </tr>
                      </thead>
                      <tbody>
                        {orders.map(order => (
                          <tr key={order._id}>
                            <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>{order._id}</td>
                            <td>{new Date(order.createdAt).toLocaleString()}</td>
                            <td>
                              <ul style={{ paddingLeft: '1rem', fontSize: '0.85rem' }}>
                                {order.items.map((item, idx) => (
                                  <li key={idx}>
                                    {item.name} (x{item.quantity})
                                  </li>
                                ))}
                              </ul>
                            </td>
                            <td style={{ fontWeight: 600 }}>R$ {order.totalAmount.toFixed(2)}</td>
                            <td>
                              <span className={`status-badge status-${order.status.toLowerCase()}`}>
                                {order.status === 'PENDING' && '⏳ Processando'}
                                {order.status === 'PAID' && '✅ Aprovado'}
                                {order.status === 'FAILED' && '❌ Recusado'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* CART SIDEBAR */}
      {isCartOpen && <div className="overlay" onClick={() => setIsCartOpen(false)}></div>}
      <div className={`cart-sidebar ${isCartOpen ? 'open' : ''}`}>
        <div className="cart-header">
          <h2 style={{ fontWeight: 800 }}>Seu Carrinho</h2>
          <button className="cart-close-btn" onClick={() => setIsCartOpen(false)}>✕</button>
        </div>

        <div className="cart-items">
          {cart.length === 0 ? (
            <p style={{ textAlign: 'center', color: 'var(--text-secondary)', marginTop: '2rem' }}>
              Seu carrinho está vazio.
            </p>
          ) : (
            cart.map(item => (
              <div key={item.product._id} className="cart-item">
                <div className="cart-item-details">
                  <div className="cart-item-title">{item.product.name}</div>
                  <div style={{ color: 'var(--accent-secondary)', fontWeight: 600 }}>
                    R$ {item.product.price.toFixed(2)}
                  </div>
                </div>
                <div className="cart-item-actions">
                  <button className="qty-btn" onClick={() => updateCartQty(item.product._id, -1)}>-</button>
                  <span style={{ minWidth: '20px', textAlign: 'center' }}>{item.quantity}</span>
                  <button className="qty-btn" onClick={() => updateCartQty(item.product._id, 1)}>+</button>
                </div>
              </div>
            ))
          )}
        </div>

        {cart.length > 0 && (
          <div className="cart-footer">
            <div className="cart-total">
              <span>Total:</span>
              <span>R$ {cartTotal.toFixed(2)}</span>
            </div>

            {checkoutMessage && (
              <div style={{
                padding: '0.5rem',
                borderRadius: '6px',
                backgroundColor: checkoutMessage.includes('Erro') ? 'rgba(239, 68, 68, 0.15)' : 'rgba(16, 185, 129, 0.15)',
                color: checkoutMessage.includes('Erro') ? 'var(--accent-danger)' : 'var(--accent-success)',
                marginBottom: '1rem',
                fontSize: '0.85rem'
              }}>
                {checkoutMessage}
              </div>
            )}

            <button
              className="btn btn-primary"
              style={{ width: '100%' }}
              onClick={handleCheckout}
              disabled={checkoutLoading}
            >
              {checkoutLoading ? 'Processando...' : 'Finalizar Compra 🚀'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
