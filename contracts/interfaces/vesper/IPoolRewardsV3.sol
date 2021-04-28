// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

interface IPoolRewardsV3 {
    /// Emitted after reward added
    event RewardAdded(uint256 reward);
    /// Emitted whenever any user claim rewards
    event RewardPaid(address indexed user, uint256 reward);
    /// Emitted when reward is ended
    event RewardEnded(address indexed dustReceiver, uint256 dust);
    // Emitted when pool governor update reward end time
    event UpdatedRewardEndTime(uint256 previousRewardEndTime, uint256 newRewardEndTime);

    function claimReward(address) external;

    function notifyRewardAmount(uint256 rewardAmount, uint256 endTime) external;

    function updateRewardEndTime() external;

    function updateReward(address) external;

    function withdrawRemaining(address _toAddress) external;

    function claimable(address) external view returns (uint256);

    function lastTimeRewardApplicable() external view returns (uint256);

    function rewardForDuration() external view returns (uint256);

    function rewardPerToken() external view returns (uint256);

    function rewardToken() external view returns (address);
}
