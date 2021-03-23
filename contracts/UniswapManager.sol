// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "./interfaces/uniswap/IUniswapV2Router02.sol";
import "./interfaces/uniswap/IUniswapV2Factory.sol";

contract UniswapManager {
    address public constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    IUniswapV2Factory public constant FACTORY =
        IUniswapV2Factory(0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f);
    IUniswapV2Router02 public constant ROUTER =
        IUniswapV2Router02(0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D);

    function bestPathFixedInput(
        address _from,
        address _to,
        uint256 _amountIn
    ) external view returns (address[] memory path, uint256 amountOut) {
        address[] memory pathB;

        path = new address[](2);
        path[0] = _from;
        path[1] = _to;
        if (_from == WETH || _to == WETH) {
            amountOut = safeGetAmountsOut(_amountIn, path)[path.length - 1];
            return (path, amountOut);
        }

        pathB = new address[](3);
        pathB[0] = _from;
        pathB[1] = WETH;
        pathB[2] = _to;
        // is one of these WETH
        if (FACTORY.getPair(_from, _to) == address(0x0)) {
            // does a direct liquidity pair not exist?
            amountOut = safeGetAmountsOut(_amountIn, pathB)[pathB.length - 1];
            path = pathB;
        } else {
            // if a direct pair exists, we want to know whether pathA or path B is better
            (path, amountOut) = comparePathsFixedInput(path, pathB, _amountIn);
        }
    }

    function bestPathFixedOutput(
        address _from,
        address _to,
        uint256 _amountOut
    ) external view returns (address[] memory path, uint256 amountIn) {
        address[] memory pathB;

        path = new address[](2);
        path[0] = _from;
        path[1] = _to;
        if (_from == WETH || _to == WETH) {
            amountIn = safeGetAmountsIn(_amountOut, path)[0];
            return (path, amountIn);
        }

        pathB = new address[](3);
        pathB[0] = _from;
        pathB[1] = WETH;
        pathB[2] = _to;

        // is one of these WETH
        if (FACTORY.getPair(_from, _to) == address(0x0)) {
            // does a direct liquidity pair not exist?
            amountIn = safeGetAmountsIn(_amountOut, pathB)[0];
            path = pathB;
        } else {
            // if a direct pair exists, we want to know whether pathA or path B is better
            (path, amountIn) = comparePathsFixedOutput(path, pathB, _amountOut);
        }
    }

    // Rather than let the getAmountsOut call fail due to low liquidity, we
    // catch the error and return 0 in place of the reversion
    // this is useful when we want to proceed with logic
    function safeGetAmountsOut(uint256 _amountIn, address[] memory path)
        public
        view
        returns (uint256[] memory result)
    {
        try ROUTER.getAmountsOut(_amountIn, path) returns (uint256[] memory amounts) {
            result = amounts;
        } catch {
            result = new uint256[](path.length);
            result[0] = _amountIn;
        }
    }

    // Just a wrapper for the uniswap call
    // This can fail (revert) in two scenarios
    // 1. (path.length == 2 && insufficient reserves)
    // 2. (path.length > 2 and an intermediate pair has an output amount of 0)
    function unsafeGetAmountsOut(uint256 _amountIn, address[] memory path)
        public
        view
        returns (uint256[] memory result)
    {
        result = ROUTER.getAmountsOut(_amountIn, path);
    }

    // Rather than let the getAmountsIn call fail due to low liquidity, we
    // catch the error and return 0 in place of the reversion
    // this is useful when we want to proceed with logic (occurs when amountOut is
    // greater than avaiable reserve (ds-math-sub-underflow)
    function safeGetAmountsIn(uint256 _amountOut, address[] memory path)
        public
        view
        returns (uint256[] memory result)
    {
        try ROUTER.getAmountsIn(_amountOut, path) returns (uint256[] memory amounts) {
            result = amounts;
        } catch {
            result = new uint256[](path.length);
            result[path.length - 1] = _amountOut;
        }
    }

    // Just a wrapper for the uniswap call
    // This can fail (revert) in one scenario
    // 1. amountOut provided is greater than reserve for out currency
    function unsafeGetAmountsIn(uint256 _amountOut, address[] memory path)
        public
        view
        returns (uint256[] memory result)
    {
        result = ROUTER.getAmountsIn(_amountOut, path);
    }

    function comparePathsFixedInput(
        address[] memory pathA,
        address[] memory pathB,
        uint256 _amountIn
    ) public view returns (address[] memory path, uint256 amountOut) {
        path = pathA;
        amountOut = safeGetAmountsOut(_amountIn, pathA)[pathA.length - 1];
        uint256 bAmountOut = safeGetAmountsOut(_amountIn, pathB)[pathB.length - 1];
        if (bAmountOut > amountOut) {
            path = pathB;
            amountOut = bAmountOut;
        }
    }

    function comparePathsFixedOutput(
        address[] memory pathA,
        address[] memory pathB,
        uint256 _amountOut
    ) public view returns (address[] memory path, uint256 amountIn) {
        path = pathA;
        amountIn = safeGetAmountsIn(_amountOut, pathA)[0];
        uint256 bAmountIn = safeGetAmountsIn(_amountOut, pathB)[0];
        if (bAmountIn < amountIn) {
            path = pathB;
            amountIn = bAmountIn;
        }
    }
}
