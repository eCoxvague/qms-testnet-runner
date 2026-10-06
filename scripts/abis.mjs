export const tokenAbi = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)',
];
export const routerAbi = [
  'function factory() view returns (address)',
  'function WQMS() view returns (address)',
  'function getAmountsOut(uint256,address[]) view returns (uint256[])',
  'function swapExactETHForTokens(uint256,address[],address,uint256) payable returns (uint256[])',
  'function addLiquidityETH(address,uint256,uint256,uint256,address,uint256) payable returns (uint256,uint256,uint256)',
];
export const factoryAbi = ['function getPair(address,address) view returns (address)'];
export const pairAbi = [
  ...tokenAbi,
  'function factory() view returns (address)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
  'function getReserves() view returns (uint112,uint112,uint32)',
];
