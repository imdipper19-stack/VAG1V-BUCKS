import { Suspense } from 'react';
import BuyerPageContent from './BuyerPageContent';

export default function BuyerPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center">Загрузка...</div>}>
      <BuyerPageContent />
    </Suspense>
  );
}
