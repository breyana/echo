import {
  getNonAdvancedPlayerIds,
  getAdvancedPlayerIds,
} from '../pool'

import PlayersGotTheirVoteAppraiser from './playersGotTheirVoteAppraiser'

export default class NonAdvancedPlayersGotTheirVoteAppraiser extends PlayersGotTheirVoteAppraiser {
  constructor(pool) {
    super(pool, getNonAdvancedPlayerIds(pool))
    this.advancedPlayerIds = new Set(getAdvancedPlayerIds(pool))
  }

  emptySeatsByGoal(teamFormationPlan) {
    const result = new Map()
    teamFormationPlan.teams.forEach(team => {
      const hasAdvancedPlayer = team.playerIds.some(id => this.advancedPlayerIds.has(id))
      const spaceForAdvancedPlayer = hasAdvancedPlayer ? 0 : 1
      const emptySeats = team.teamSize - (team.playerIds.length + spaceForAdvancedPlayer)
      const currentCount = result.get(team.goalDescriptor) || 0
      result.set(team.goalDescriptor, currentCount + emptySeats)
    })
    return result
  }
}
