import {Select} from '@base-ui/react/select';
import {Check,ChevronDown} from 'lucide-react';

type WalletOption={id:string;name:string;address:string};
type Props={
  id:string;label:string;value:string;wallets:readonly WalletOption[];
  placeholder:string;onChange:(value:string)=>void;onBlur?:()=>void;
  describedBy?:string;invalid?:boolean;required?:boolean;disabled?:boolean;
};

export default function WalletSelect({id,label,value,wallets,placeholder,onChange,onBlur,describedBy,invalid,required,disabled}:Props){
  const selected=wallets.find(wallet=>wallet.id===value);
  const items=[{value:'',label:placeholder},...wallets.map(wallet=>({value:wallet.id,label:wallet.name}))];
  return <Select.Root<string> value={value} items={items} onValueChange={next=>onChange(next||'')} required={required} disabled={disabled} modal={false}>
    <Select.Trigger id={id} className="wallet-select-trigger" aria-label={label} aria-describedby={describedBy} aria-invalid={invalid||undefined} onBlur={onBlur}>
      <Select.Value className="wallet-select-value">{()=>selected?.name||placeholder}</Select.Value>
      <Select.Icon className="wallet-select-icon"><ChevronDown size={17} aria-hidden="true"/></Select.Icon>
    </Select.Trigger>
    <Select.Portal>
      <Select.Positioner className="wallet-select-positioner" alignItemWithTrigger={false} align="start" sideOffset={8} collisionPadding={12}>
        <Select.Popup className="wallet-select-popup">
          <Select.List className="wallet-select-list">
            <Select.Item value="" label={placeholder} className="wallet-select-option wallet-select-clear">
              <Select.ItemText>{placeholder}</Select.ItemText>
              <Select.ItemIndicator className="wallet-select-check"><Check size={17} aria-hidden="true"/></Select.ItemIndicator>
            </Select.Item>
            {wallets.map(wallet=><Select.Item key={wallet.id} value={wallet.id} label={wallet.name} className="wallet-select-option">
              <Select.ItemText className="wallet-select-option-text"><span>{wallet.name}</span><span className="wallet-select-address">{wallet.address.slice(0,5)}…{wallet.address.slice(-5)}</span></Select.ItemText>
              <Select.ItemIndicator className="wallet-select-check"><Check size={17} aria-hidden="true"/></Select.ItemIndicator>
            </Select.Item>)}
            {!wallets.length&&<div className="wallet-select-empty">No available wallets. Add one in Wallets.</div>}
          </Select.List>
        </Select.Popup>
      </Select.Positioner>
    </Select.Portal>
  </Select.Root>;
}
