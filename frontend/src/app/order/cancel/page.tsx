import { Suspense } from 'react';
import OrderCancelContent from './OrderCancelContent';

export default function OrderCancelPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center text-white">Загрузка...</div>}>
      <OrderCancelContent />
    </Suspense>
  );
}
