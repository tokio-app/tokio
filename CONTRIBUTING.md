# Contributing

By participating in this project, you agree to abide by the Tokio [code of conduct].

[code of conduct]: https://github.com/tokio-app/tokio/blob/main/CODE_OF_CONDUCT.md

To start, [Fork][fork] and then clone the repo to your local machine:

    git clone https://github.com/<username>/tokio.git

[fork]: https://github.com/tokio-app/tokio/fork

System requirements:

    node >= 24.18.0
    yarn >= 1.22.22

Navigate to the project directory:

    cd tokio

Install the dependencies:

    yarn install

Start the application development server:

    yarn dev

Quit Tokio first if it's installed (closing its window keeps it running in the tray): only one copy runs per data folder, so `yarn dev` would quit and bring the open one to the front.

Start making changes, commit and push to your fork and [submit a pull request][pr].

[pr]: https://github.com/tokio-app/tokio/compare

At this point you're waiting on us. We may suggest
some changes or improvements or alternatives.

CI checks every pull request with Prettier, lint, typecheck and tests, and checks its commit messages. Lint fails on warnings too. Run `yarn format`, `yarn lint`, `yarn typecheck` and `yarn test` before pushing to catch failures early.

Some things that will increase the chance that your pull request is accepted:

- Follow our Pull Request template.
- Follow our [commit style][commit].

[commit]: https://www.conventionalcommits.org/en/v1.0.0/#specification
