import { Button } from '@acme/ui';
import { formatCurrency } from '@acme/utils/format';

export const App = () => (
  <div>
    <Button label={formatCurrency(42)} />
  </div>
);
