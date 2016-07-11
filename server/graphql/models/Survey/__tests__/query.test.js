/* eslint-env mocha */
/* global expect, testContext */
/* eslint-disable prefer-arrow-callback, no-unused-expressions */

import nock from 'nock'
import fields from '../query'
import r from '../../../../../db/connect'
import saveProjectReviewCLISurveyResponsesForPlayer from '../../../../../server/actions/saveProjectReviewCLISurveyResponsesForPlayer'
import factory from '../../../../../test/factories'
import {withDBCleanup, runGraphQLQuery, useFixture} from '../../../../../test/helpers'

describe(testContext(__filename), function () {
  withDBCleanup()
  useFixture.buildSurvey()

  describe('Retrospective queries', function () {
    beforeEach('Setup Retrospective Survey Data', async function () {
      const teamQuestion = await factory.create('question', {
        responseType: 'relativeContribution',
        subjectType: 'team'
      })
      const playerQuestion = await factory.create('question', {
        body: 'What is one thing {{subject}} did well?',
        responseType: 'text',
        subjectType: 'player'
      })
      await this.buildSurvey([
        {questionId: teamQuestion.id, subjectIds: () => this.teamPlayerIds},
        {questionId: playerQuestion.id, subjectIds: () => [this.teamPlayerIds[1]]},
      ])
      this.currentUser = await factory.build('user', {id: this.teamPlayerIds[0]})

      const idmUsers = await Promise.all(this.teamPlayerIds.map(id => factory.build('user', {id})))
      nock(process.env.IDM_BASE_URL)
        .post('/graphql')
        .reply(200, JSON.stringify({data: {getUsersByIds: idmUsers}}))
    })

    afterEach(function () {
      nock.cleanAll()
    })

    describe('getRetrospectiveSurveyQuestion', function () {
      it('gets a single question from the survey by index', function () {
        const questionNumber = 2 // <-- 1-based arg
        const questionIndex = 1 // <-- 0-based index

        return runGraphQLQuery(
          `query($questionNumber: Int!) {
            getRetrospectiveSurveyQuestion(questionNumber: $questionNumber) {
              id subjectType responseType body
              subjects { id name handle }
            }
          }
          `,
          fields,
          {questionNumber},
          {currentUser: this.currentUser}
        ).then(result =>
          expect(result.data.getRetrospectiveSurveyQuestion)
            .to.have.property('id', this.survey.questionRefs[questionIndex].questionId)
        )
      })

      it('accepts a projectName parameter', function () {
        const questionNumber = 2 // <-- 1-based arg
        const questionIndex = 1 // <-- 0-based index

        return runGraphQLQuery(
          `query($questionNumber: Int!, $projectName: String) {
            getRetrospectiveSurveyQuestion(questionNumber: $questionNumber, projectName: $projectName) {
              id
            }
          }
          `,
          fields,
          {questionNumber, projectName: this.project.name},
          {currentUser: this.currentUser}
        ).then(result =>
          expect(result.data.getRetrospectiveSurveyQuestion)
            .to.have.property('id', this.survey.questionRefs[questionIndex].questionId)
        )
      })
    })

    describe('getRetrospectiveSurvey', function () {
      it('returns the survey for the correct cycle and project for the current user', function () {
        return runGraphQLQuery(
          `query {
            getRetrospectiveSurvey {
              id
              cycle { id }
              project { id }
              questions {
                id subjectType responseType body
                subjects { id name handle }
                response { value }
              }
            }
          }
          `,
          fields,
          undefined,
          {currentUser: this.currentUser}
        ).then(result =>
          expect(result.data.getRetrospectiveSurvey.id).to.eq(this.survey.id)
        )
      })

      it('treats the question body like a template', function () {
        return runGraphQLQuery(
          `query {
            getRetrospectiveSurvey {
              questions {
                body
                subjects { handle }
              }
            }
          }
          `,
          fields,
          undefined,
          {currentUser: this.currentUser}
        )
        .then(result => {
          const question = result.data.getRetrospectiveSurvey.questions[1]
          expect(question.body).to.contain(`@${question.subjects[0].handle}`)
        })
      })

      it('accepts a projectName parameter', function () {
        return runGraphQLQuery(
          `query($projectName: String) {
            getRetrospectiveSurvey(projectName: $projectName) { id }
          }
          `,
          fields,
          {projectName: this.project.name},
          {currentUser: this.currentUser}
        ).then(result =>
          expect(result.data.getRetrospectiveSurvey.id).to.eq(this.survey.id)
        )
      })

      it('returns a meaningful error when lookup fails', function () {
        return r.table('surveys').get(this.survey.id).delete()
          .then(() => expect(
            runGraphQLQuery('query { getRetrospectiveSurvey { id } }',
              fields,
              undefined,
              {currentUser: this.currentUser}
            )
          ).to.be.rejectedWith(/no retrospective survey/))
      })
    })
  })
  describe('Project Review Queries', function () {
    useFixture.createProjectReviewSurvey()

    beforeEach('Setup Project Review Survey Data', async function () {
      await this.createProjectReviewSurvey()
      this.currentUser = await factory.build('user', {id: this.teamPlayerIds[0]})

      this.invokeAPI = () => runGraphQLQuery(
        `query($projectName: String!) {
          getProjectReviewSurveyStatus(projectName: $projectName) {
            project { artifactURL }
            completed
            responses {
              questionName
              response { value }
            }
          }
        }`,
        fields,
        {projectName: this.project.name},
        {currentUser: this.currentUser}
      )
    })

    describe('when player has not started the review', function () {
      it('returns the status showing no progress', function () {
        return this.invokeAPI().then(result => {
          const status = result.data.getProjectReviewSurveyStatus
          expect(status).to.deep.eq({
            completed: false,
            project: {
              artifactURL: this.project.artifactURL
            },
            responses: [],
          })
        })
      })
    })

    describe('when the review is in progress', function () {
      beforeEach(function () {
        return saveProjectReviewCLISurveyResponsesForPlayer(this.currentUser.id, this.project.name, [
          {questionName: 'A', responseParams: ['8']},
        ])
      })

      it('returns the status showing the review in progress', function () {
        return this.invokeAPI().then(result => {
          const status = result.data.getProjectReviewSurveyStatus
          expect(status).to.deep.eq({
            completed: false,
            project: {
              artifactURL: this.project.artifactURL
            },
            responses: [
              {questionName: 'A', response: {value: '8'}}
            ],
          })
        })
      })
    })

    describe('when player has completed the review', function () {
      beforeEach(function () {
        return saveProjectReviewCLISurveyResponsesForPlayer(this.currentUser.id, this.project.name, [
          {questionName: 'A', responseParams: ['8']},
          {questionName: 'B', responseParams: ['9']},
        ])
      })

      it('returns the status showing the completed review', function () {
        return this.invokeAPI().then(result => {
          const status = result.data.getProjectReviewSurveyStatus
          expect(status).to.deep.eq({
            completed: true,
            project: {
              artifactURL: this.project.artifactURL
            },
            responses: [
              {questionName: 'A', response: {value: '8'}},
              {questionName: 'B', response: {value: '9'}},
            ],
          })
        })
      })
    })
    it('returns a meaningful error when lookup fails', function () {
      return r.table('surveys').get(this.survey.id).delete()
        .then(() => expect(this.invokeAPI()).to.be.rejectedWith(/no project review survey/i))
    })
  })
})
