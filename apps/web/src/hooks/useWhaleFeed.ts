import { useEffect, useRef } from 'react';
import { useAppStore } from '../stores/appStore';

const WS_URL = 'ws://localhost:3001/ws';

export function useWhaleFeed() {
  const ws = useRef<WebSocket | null>(null);
  const { addWhaleTrade, setConnected } = useAppStore();

  useEffect(() => {
    const connect = () => {
      ws.current = new WebSocket(WS_URL);
      
      ws.current.onopen = () => {
        console.log('[WS] Connected');
        setConnected(true);
      };
      
      ws.current.onmessage = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.type === 'whale_trade') {
          addWhaleTrade(msg.data);
        }
      };
      
      ws.current.onclose = () => {
        setConnected(false);
        setTimeout(connect, 3000);
      };

      ws.current.onerror = () => {
        setConnected(false);
      };
    };

    connect();

    return () => {
      ws.current?.close();
    };
  }, [addWhaleTrade, setConnected]);
}



