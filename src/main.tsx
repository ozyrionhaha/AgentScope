import { StrictMode, Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles.css';
class ErrorBoundary extends Component<{children:ReactNode},{error:string}>{state={error:''};static getDerivedStateFromError(error:Error){return {error:error.message};}render(){return this.state.error?<main className="boot-screen"><h1>The workspace hit an error.</h1><p>{this.state.error}</p><button onClick={()=>location.reload()}>Reload workspace</button></main>:this.props.children;}}
createRoot(document.getElementById('root')!).render(<StrictMode><ErrorBoundary><App/></ErrorBoundary></StrictMode>);
